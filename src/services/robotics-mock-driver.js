import { base64ToBytes } from '../utils/base64';
import { logger } from '../utils/logger';
import {
  resolveRoboticsSimulatorURLs,
  saveRoboticsSimulatorURL
} from './robotics-simulator-config';

const DEFAULT_URL = process.env.EXPO_PUBLIC_ROBOTICS_SIMULATOR_URL || 'ws://127.0.0.1:9090';
const REQUEST_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 2500;
const MOCK_UUIDS = Object.freeze({
  service: process.env.EXPO_PUBLIC_VL01_SERVICE_UUID || 'f0001100-0451-4000-b000-000000000000',
  battery: process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || 'f0001101-0451-4000-b000-000000000000',
  status: process.env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID || 'f0001102-0451-4000-b000-000000000000',
  event: process.env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID || 'f0001103-0451-4000-b000-000000000000',
  command: process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID || 'f0001104-0451-4000-b000-000000000000'
});
export const BLE_MTU = 20;
export const FRAGMENT_PAYLOAD_BYTES = BLE_MTU - 2;

function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b || 0) << 8) | (c || 0);
    output += alphabet[(triple >>> 18) & 63];
    output += alphabet[(triple >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >>> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return output;
}

function utf8Bytes(value) {
  if (typeof globalThis.TextEncoder !== 'undefined') return new globalThis.TextEncoder().encode(value);
  const escaped = unescape(encodeURIComponent(value));
  return Uint8Array.from(escaped, (character) => character.charCodeAt(0));
}

export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

export function encodeRoboticsCommand(action) {
  const actionBytes = utf8Bytes(JSON.stringify(action));
  return utf8Bytes(JSON.stringify({ action, checksum: crc16(actionBytes) }));
}

export function fragmentPayload(payload, mtu = BLE_MTU) {
  const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload || []);
  const chunkSize = mtu - 2;
  if (chunkSize <= 0) throw new Error('MTU must leave room for the fragmentation header');
  const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
  if (total > 255) throw new Error('Payload requires too many fragments');
  return Array.from({ length: total }, (_, index) => {
    const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize);
    return Uint8Array.from([index, total, ...chunk]);
  });
}

function mockError(message, code = 'ROBOTICS_MOCK_ERROR') {
  return Object.assign(new Error(message), { code });
}

export class RoboticsMockDriver {
  constructor({
    url = DEFAULT_URL,
    WebSocketImpl = globalThis.WebSocket,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    resolveURLs = null
  } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.resolveURLs = resolveURLs || (() => resolveRoboticsSimulatorURLs({ configuredURL: this.url }));
    this.socket = null;
    this.openPromise = null;
    this.nextRequestId = 0;
    this.nextCommandId = 0;
    this.pending = new Map();
    this.notificationHandlers = new Map();
    this.notificationServices = new Map();
    this.eventHandler = {};
    this.connectedDevices = new Map();
    this.activeScan = null;
    this.connectionState = 'disconnected';
    this.connectionStateHandlers = new Set();
    this.disposed = false;
    this.connectionGeneration = 0;
  }

  setEventHandler(handler) {
    this.eventHandler = handler || {};
    return () => { if (this.eventHandler === handler) this.eventHandler = {}; };
  }

  addConnectionStateListener(handler) {
    if (typeof handler !== 'function') return () => {};
    this.connectionStateHandlers.add(handler);
    handler(this.connectionState);
    return () => this.connectionStateHandlers.delete(handler);
  }

  setConnectionState(state, context = {}) {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const handler of this.connectionStateHandlers) handler(state, context);
  }

  isDeviceConnected(deviceId) {
    return this.connectionState === 'connected' && this.connectedDevices.has(deviceId);
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  handleSocketClosed(socket, error = mockError('Simulator disconnected', 'BLE_CONNECT_FAILED')) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.openPromise = null;
    this.rejectPending(error);
    const connectedIds = [...this.connectedDevices.keys()];
    this.connectedDevices.clear();
    this.setConnectionState('disconnected', { errorCode: error.code });
    for (const deviceId of connectedIds) this.eventHandler.onDisconnected?.(deviceId, error);
  }

  connectSocket(url, generation) {
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(url);
      let settled = false;
      const finishFailure = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try { socket.close?.(); } catch {}
        reject(mockError('Robotics simulator connection failed', 'BLE_CONNECT_FAILED'));
      };
      const timer = setTimeout(finishFailure, this.connectTimeoutMs);
      socket.onopen = () => {
        if (settled) return;
        if (this.disposed || generation !== this.connectionGeneration) {
          finishFailure();
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.socket = socket;
        socket.onmessage = (event) => this.handleMessage(event.data);
        socket.onerror = () => {
          try { socket.close?.(); } catch {}
          this.handleSocketClosed(socket);
        };
        socket.onclose = () => this.handleSocketClosed(socket);
        resolve(socket);
      };
      socket.onerror = finishFailure;
      socket.onclose = finishFailure;
    });
  }

  async ensureSocket() {
    if (this.socket?.readyState === 1) return this.socket;
    if (this.openPromise) return this.openPromise;
    if (!this.WebSocketImpl) throw mockError('WebSocket is unavailable', 'BLE_UNAVAILABLE');
    if (this.disposed) throw mockError('Robotics mock driver is disposed', 'BLE_UNAVAILABLE');
    this.setConnectionState('connecting');
    const generation = this.connectionGeneration;
    this.openPromise = Promise.resolve().then(async () => {
      const candidates = await this.resolveURLs();
      let lastError;
      for (const candidate of candidates) {
        try {
          const socket = await this.connectSocket(candidate, generation);
          if (this.disposed || generation !== this.connectionGeneration) {
            try { socket.close?.(); } catch {}
            throw mockError('Robotics simulator connection was superseded', 'BLE_CONNECT_FAILED');
          }
          this.url = candidate;
          this.setConnectionState('socket-connected', { simulatorURL: candidate });
          logger.info('[RoboticsMock] connected', { simulator: true, fallbackUsed: candidate !== candidates[0] });
          return socket;
        } catch (error) {
          lastError = error;
          logger.warn('[RoboticsMock] simulator candidate unavailable', { candidateIndex: candidates.indexOf(candidate) });
        }
      }
      this.setConnectionState('disconnected', { errorCode: lastError?.code });
      throw lastError || mockError('No robotics simulator URL is available', 'BLE_CONNECT_FAILED');
    }).finally(() => {
      this.openPromise = null;
    });
    return this.openPromise;
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(mockError(message.error?.message || 'Simulator operation failed', message.error?.code));
      return;
    }
    if (message.type === 'disconnected') {
      this.connectedDevices.delete(message.deviceId);
      this.eventHandler.onDisconnected?.(message.deviceId, mockError(message.reason, 'BLE_CONNECT_FAILED'));
      return;
    }
    if (message.type !== 'notification') return;
    const key = `${message.deviceId}:${message.characteristicUUID}`;
    for (const callback of this.notificationHandlers.get(key) || []) callback(message.value);
    const lowerUUID = String(message.characteristicUUID).toLowerCase();
    if (lowerUUID === MOCK_UUIDS.battery.toLowerCase()) this.eventHandler.onBattery?.(message.deviceId, base64ToBytes(message.value)[0]);
    else if (lowerUUID === MOCK_UUIDS.status.toLowerCase()) this.eventHandler.onStatus?.(message.deviceId, message.value);
    else if (lowerUUID === MOCK_UUIDS.event.toLowerCase()) this.eventHandler.onEvent?.(message.deviceId, message.value);
  }

  async request(type, payload = {}, { fireAndForget = false } = {}) {
    const socket = await this.ensureSocket();
    const id = `mock-${++this.nextRequestId}`;
    const message = JSON.stringify({ id, type, ...payload });
    if (fireAndForget) {
      try {
        socket.send(message);
      } catch (error) {
        throw mockError('Simulator connection was lost while sending', 'BLE_CONNECT_FAILED');
      }
      return true;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(mockError('Simulator request timed out', 'BLE_CONNECT_TIMEOUT'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(mockError('Simulator connection was lost while sending', 'BLE_CONNECT_FAILED'));
      }
    });
  }

  async scan() {
    return this.request('scan');
  }

  async scanForDevices(onDevice, { onError, onComplete } = {}) {
    let cancelled = false;
    this.activeScan = { cancel: () => { cancelled = true; } };
    try {
      const devices = await this.scan();
      if (!cancelled) devices.forEach((device) => onDevice?.(device));
      if (!cancelled) onComplete?.('complete');
    } catch (error) {
      if (!cancelled) onError?.(error);
      if (!cancelled) onComplete?.('error');
    }
    return () => { cancelled = true; };
  }

  stopScan() {
    this.activeScan?.cancel();
    this.activeScan = null;
  }

  async connect(device) {
    if (!device?.id) throw mockError('A simulator device id is required', 'BLE_INVALID_DEVICE');
    const result = await this.request('connect', { deviceId: device.id });
    await this.discoverServices(device.id);
    const batteryValue = await this.readCharacteristic(device.id, MOCK_UUIDS.service, MOCK_UUIDS.battery);
    for (const characteristicUUID of [MOCK_UUIDS.battery, MOCK_UUIDS.status, MOCK_UUIDS.event]) {
      await this.request('subscribe', { deviceId: device.id, serviceUUID: MOCK_UUIDS.service, characteristicUUID });
    }
    if (this.socket?.readyState !== 1) throw mockError('Simulator disconnected during robot setup', 'BLE_CONNECT_FAILED');
    const connected = { ...result, battery: base64ToBytes(batteryValue)[0], connected: true, connectionState: 'connected', autoReconnect: true, roboticsMock: true };
    this.connectedDevices.set(device.id, connected);
    await this.restoreSubscriptions(device.id);
    this.setConnectionState('connected', { deviceId: device.id });
    return connected;
  }

  reconnect(device) { return this.connect(device); }
  discoverServices(deviceId) { return this.request('discoverServices', { deviceId }); }
  readCharacteristic(deviceId, serviceUUID, characteristicUUID) {
    return this.request('readCharacteristic', { deviceId, serviceUUID, characteristicUUID }).then((result) => result.value);
  }

  async writeCharacteristic(deviceId, serviceUUID, characteristicUUID, payload, { withoutResponse = false, commandId } = {}) {
    const bytes = typeof payload === 'string' ? base64ToBytes(payload) : payload;
    const fragments = fragmentPayload(bytes);
    const resolvedCommandId = commandId || `cmd-${Date.now()}-${++this.nextCommandId}`;
    let result;
    for (let index = 0; index < fragments.length; index += 1) {
      const isLast = index === fragments.length - 1;
      result = await this.request('writeCharacteristic', {
        deviceId,
        serviceUUID,
        characteristicUUID,
        commandId: resolvedCommandId,
        value: bytesToBase64(fragments[index]),
        withoutResponse
      }, { fireAndForget: withoutResponse && !isLast });
    }
    return result;
  }

  writeCommand(deviceId, base64Value, { withResponse = true } = {}) {
    return this.writeCharacteristic(
      deviceId,
      MOCK_UUIDS.service,
      MOCK_UUIDS.command,
      base64Value,
      { withoutResponse: !withResponse }
    ).then(() => true);
  }

  async subscribeToNotifications(deviceId, serviceUUID, characteristicUUID, callback) {
    const key = `${deviceId}:${characteristicUUID}`;
    if (!this.notificationHandlers.has(key)) this.notificationHandlers.set(key, new Set());
    this.notificationHandlers.get(key).add(callback);
    this.notificationServices.set(key, serviceUUID);
    try {
      await this.request('subscribe', { deviceId, serviceUUID, characteristicUUID });
    } catch (error) {
      this.notificationHandlers.get(key)?.delete(callback);
      if (this.notificationHandlers.get(key)?.size === 0) this.notificationServices.delete(key);
      throw error;
    }
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const handlers = this.notificationHandlers.get(key);
      handlers?.delete(callback);
      if (handlers?.size === 0) {
        this.notificationHandlers.delete(key);
        this.notificationServices.delete(key);
        if (this.socket?.readyState === 1) {
          this.request('unsubscribe', { deviceId, serviceUUID, characteristicUUID }, { fireAndForget: true }).catch(() => {});
        }
      }
    };
  }

  async restoreSubscriptions(deviceId) {
    for (const [key, handlers] of this.notificationHandlers) {
      if (!handlers.size || !key.startsWith(`${deviceId}:`)) continue;
      const characteristicUUID = key.slice(deviceId.length + 1);
      await this.request('subscribe', {
        deviceId,
        serviceUUID: this.notificationServices.get(key),
        characteristicUUID
      });
    }
  }

  spawnRobot() { return this.request('spawn'); }
  setRobotCount(count) { return this.request('setRobotCount', { count }); }
  controlRobot(deviceId, control) { return this.request('control', { deviceId, control }); }

  async setSimulatorURL(url) {
    const saved = await saveRoboticsSimulatorURL(url);
    this.url = saved || DEFAULT_URL;
    this.connectionGeneration += 1;
    const connectedIds = [...this.connectedDevices.keys()];
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      try { socket.close?.(); } catch {}
    }
    this.rejectPending(mockError('Simulator URL changed', 'BLE_CONNECT_FAILED'));
    this.connectedDevices.clear();
    this.setConnectionState('disconnected');
    const error = mockError('Simulator URL changed', 'BLE_CONNECT_FAILED');
    for (const deviceId of connectedIds) this.eventHandler.onDisconnected?.(deviceId, error);
    return saved;
  }

  async disconnect(deviceId) {
    if (this.socket?.readyState === 1) {
      await this.request('disconnect', { deviceId }, { fireAndForget: true }).catch(() => {});
    }
    this.connectedDevices.delete(deviceId);
    for (const key of this.notificationHandlers.keys()) {
      if (!key.startsWith(`${deviceId}:`)) continue;
      this.notificationHandlers.delete(key);
      this.notificationServices.delete(key);
    }
    if (!this.connectedDevices.size) this.setConnectionState(this.socket?.readyState === 1 ? 'socket-connected' : 'disconnected');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.connectionGeneration += 1;
    this.stopScan();
    this.rejectPending(mockError('Robotics mock driver disposed', 'BLE_CONNECT_FAILED'));
    this.notificationHandlers.clear();
    this.notificationServices.clear();
    this.connectionStateHandlers.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close?.(); } catch {}
    }
  }
}

export const roboticsMockDriver = new RoboticsMockDriver();
export const bleService = roboticsMockDriver;
export default roboticsMockDriver;
