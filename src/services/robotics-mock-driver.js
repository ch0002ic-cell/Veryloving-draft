import { base64ToBytes } from '../utils/base64';
import { logger } from '../utils/logger';

const DEFAULT_URL = process.env.EXPO_PUBLIC_ROBOTICS_SIMULATOR_URL || 'ws://127.0.0.1:9090';
const REQUEST_TIMEOUT_MS = 5000;
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
  constructor({ url = DEFAULT_URL, WebSocketImpl = globalThis.WebSocket, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.socket = null;
    this.openPromise = null;
    this.nextRequestId = 0;
    this.pending = new Map();
    this.notificationHandlers = new Map();
    this.eventHandler = {};
    this.connectedDevices = new Map();
    this.activeScan = null;
  }

  setEventHandler(handler) {
    this.eventHandler = handler || {};
    return () => { if (this.eventHandler === handler) this.eventHandler = {}; };
  }

  async ensureSocket() {
    if (this.socket?.readyState === 1) return this.socket;
    if (this.openPromise) return this.openPromise;
    if (!this.WebSocketImpl) throw mockError('WebSocket is unavailable', 'BLE_UNAVAILABLE');
    this.openPromise = new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(this.url);
      this.socket = socket;
      const fail = () => {
        this.openPromise = null;
        reject(mockError('Robotics simulator connection failed', 'BLE_CONNECT_FAILED'));
      };
      socket.onopen = () => {
        this.openPromise = null;
        logger.info('[RoboticsMock] connected', { simulator: true });
        resolve(socket);
      };
      socket.onerror = fail;
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onclose = () => {
        this.openPromise = null;
        this.socket = null;
        for (const pending of this.pending.values()) pending.reject(mockError('Simulator disconnected', 'BLE_CONNECT_FAILED'));
        this.pending.clear();
        for (const deviceId of this.connectedDevices.keys()) this.eventHandler.onDisconnected?.(deviceId, null);
        this.connectedDevices.clear();
      };
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
    if (lowerUUID.includes('1101')) this.eventHandler.onBattery?.(message.deviceId, base64ToBytes(message.value)[0]);
    else if (lowerUUID.includes('1102')) this.eventHandler.onStatus?.(message.deviceId, message.value);
    else if (lowerUUID.includes('1103')) this.eventHandler.onEvent?.(message.deviceId, message.value);
  }

  async request(type, payload = {}, { fireAndForget = false } = {}) {
    const socket = await this.ensureSocket();
    const id = `mock-${++this.nextRequestId}`;
    const message = JSON.stringify({ id, type, ...payload });
    if (fireAndForget) {
      socket.send(message);
      return true;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(mockError('Simulator request timed out', 'BLE_CONNECT_TIMEOUT'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(message);
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
    const batteryValue = await this.readCharacteristic(device.id, null, process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || 'f0001101-0451-4000-b000-000000000000');
    const connected = { ...result, battery: base64ToBytes(batteryValue)[0], connected: true, connectionState: 'connected', autoReconnect: true };
    this.connectedDevices.set(device.id, connected);
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
    const resolvedCommandId = commandId || `cmd-${Date.now()}-${this.nextRequestId + 1}`;
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
      process.env.EXPO_PUBLIC_VL01_SERVICE_UUID,
      process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID,
      base64Value,
      { withoutResponse: !withResponse }
    ).then(() => true);
  }

  async subscribeToNotifications(deviceId, serviceUUID, characteristicUUID, callback) {
    const key = `${deviceId}:${characteristicUUID}`;
    if (!this.notificationHandlers.has(key)) this.notificationHandlers.set(key, new Set());
    this.notificationHandlers.get(key).add(callback);
    await this.request('subscribe', { deviceId, serviceUUID, characteristicUUID });
    return () => this.notificationHandlers.get(key)?.delete(callback);
  }

  spawnRobot() { return this.request('spawn'); }
  setRobotCount(count) { return this.request('setRobotCount', { count }); }
  controlRobot(deviceId, control) { return this.request('control', { deviceId, control }); }

  async disconnect(deviceId) {
    this.connectedDevices.delete(deviceId);
    for (const key of this.notificationHandlers.keys()) if (key.startsWith(`${deviceId}:`)) this.notificationHandlers.delete(key);
  }
}

export const roboticsMockDriver = new RoboticsMockDriver();
export const bleService = roboticsMockDriver;
export default roboticsMockDriver;
