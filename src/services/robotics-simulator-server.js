'use strict';
/* global Buffer */

const { WebSocketServer, WebSocket } = require('ws');

const DEFAULT_PORT = 9090;
const DEFAULT_HOST = '127.0.0.1';
const TELEMETRY_INTERVAL_MS = 100;
const ROBOTICS_SERVICE_UUID = process.env.ROBOTICS_SERVICE_UUID || 'f000aa00-0451-4000-b000-000000000000';
const UUIDS = Object.freeze({
  service: process.env.EXPO_PUBLIC_VL01_SERVICE_UUID || 'f0001100-0451-4000-b000-000000000000',
  battery: process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || 'f0001101-0451-4000-b000-000000000000',
  status: process.env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID || 'f0001102-0451-4000-b000-000000000000',
  event: process.env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID || 'f0001103-0451-4000-b000-000000000000',
  command: process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID || 'f0001104-0451-4000-b000-000000000000',
  roboticsService: ROBOTICS_SERVICE_UUID,
  telemetry: process.env.ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID || 'f000aa01-0451-4000-b000-000000000000'
});

function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function commandBytes(action) {
  return Buffer.from(JSON.stringify(action), 'utf8');
}

function createCommandPacket(action) {
  const payload = commandBytes(action);
  return Buffer.from(JSON.stringify({ action, checksum: crc16(payload) }), 'utf8');
}

function parseCommandPacket(bytes) {
  const packet = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!packet?.action || !Number.isInteger(packet.checksum)) throw new Error('Command packet is malformed');
  if (crc16(commandBytes(packet.action)) !== packet.checksum) throw new Error('Command checksum is invalid');
  return packet.action;
}

function encodeValue(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
  return bytes.toString('base64');
}

function redactedLog(logger, message, context = {}) {
  const sanitized = { ...context };
  if ('latitude' in sanitized || 'longitude' in sanitized) {
    delete sanitized.latitude;
    delete sanitized.longitude;
    sanitized.location = '[SIM: LAT/LNG]';
  }
  logger.info?.(`[RoboticsSim] ${message}`, sanitized);
}

class SimulatedRobot {
  constructor(id, notify, logger = console) {
    this.id = id;
    this.name = `VeryLoving Robot ${id.split('-').pop()}`;
    this.notify = notify;
    this.logger = logger;
    this.connectedClients = new Set();
    this.subscriptions = new Map();
    this.fragments = new Map();
    this.telemetry = { latitude: 1.3521, longitude: 103.8198, battery: 100, heading: 0, speed: 0 };
    this.target = null;
    this.obstacle = false;
    this.disconnected = false;
    this.errorMode = { timeoutRate: 0, invalidCRCRate: 0, busyRate: 0 };
  }

  definition() {
    return {
      id: this.id,
      name: this.name,
      rssi: -42,
      serviceUUIDs: [UUIDS.service, UUIDS.roboticsService],
      simulated: true
    };
  }

  characteristicDefinitions() {
    return [
      { uuid: UUIDS.battery, serviceUUID: UUIDS.service, isReadable: true, isNotifiable: true },
      { uuid: UUIDS.status, serviceUUID: UUIDS.service, isReadable: true, isNotifiable: true },
      { uuid: UUIDS.event, serviceUUID: UUIDS.service, isReadable: false, isNotifiable: true },
      { uuid: UUIDS.command, serviceUUID: UUIDS.service, isWritableWithResponse: true, isWritableWithoutResponse: true },
      { uuid: UUIDS.telemetry, serviceUUID: UUIDS.roboticsService, isReadable: true, isNotifiable: true }
    ];
  }

  read(characteristicUUID) {
    if (characteristicUUID === UUIDS.battery) return Buffer.from([this.telemetry.battery]);
    if (characteristicUUID === UUIDS.status) return Buffer.from(JSON.stringify(this.status()));
    if (characteristicUUID === UUIDS.telemetry) return Buffer.from(JSON.stringify(this.telemetry));
    throw new Error('Characteristic is not readable');
  }

  status() {
    return { state: this.obstacle ? 'STOPPED' : this.target ? 'MOVING' : 'IDLE', obstacle: this.obstacle };
  }

  subscribe(client, characteristicUUID) {
    if (!this.subscriptions.has(client)) this.subscriptions.set(client, new Set());
    this.subscriptions.get(client).add(characteristicUUID);
  }

  emit(characteristicUUID, value) {
    for (const [client, subscriptions] of this.subscriptions) {
      if (client.readyState === WebSocket.OPEN && subscriptions.has(characteristicUUID)) {
        this.notify(client, {
          type: 'notification',
          deviceId: this.id,
          characteristicUUID,
          value: encodeValue(value)
        });
      }
    }
  }

  acceptFragment(client, frame) {
    const bytes = Buffer.from(frame.value || '', 'base64');
    if (bytes.length > 20 || bytes.length < 2) throw new Error('Invalid 20-byte MTU fragment');
    const index = bytes[0];
    const total = bytes[1];
    if (!total || index >= total) throw new Error('Invalid fragment header');
    const key = `${frame.commandId || 'default'}:${client._roboticsClientId}`;
    let assembly = this.fragments.get(key);
    if (!assembly || assembly.total !== total) assembly = { total, chunks: new Array(total), received: 0 };
    if (!assembly.chunks[index]) assembly.received += 1;
    assembly.chunks[index] = bytes.subarray(2);
    this.fragments.set(key, assembly);
    if (assembly.received !== total) return { complete: false, index };
    this.fragments.delete(key);
    const payload = Buffer.concat(assembly.chunks);
    const action = parseCommandPacket(payload);
    this.execute(action);
    return { complete: true, action: action.type || action.name || 'command' };
  }

  execute(action) {
    const type = String(action.type || action.name || '').toUpperCase();
    if (type.includes('STOP')) {
      this.target = null;
      this.telemetry.speed = 0;
      this.emit(UUIDS.event, { type: 'STOPPED', reason: action.reason || 'command' });
    } else if (type.includes('NAVIGATE')) {
      const latitude = Number(action.latitude);
      const longitude = Number(action.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Navigation coordinates are invalid');
      this.target = { latitude, longitude };
      this.emit(UUIDS.event, { type: 'NAVIGATION_STARTED' });
      redactedLog(this.logger, 'navigation accepted', { robotId: this.id, latitude, longitude });
    } else if (type.includes('FIND')) {
      this.emit(UUIDS.event, { type: 'ROBOT_FOUND', audible: true });
    }
    this.emit(UUIDS.status, this.status());
  }

  control(control = {}) {
    if (Number.isFinite(control.battery)) this.telemetry.battery = Math.max(0, Math.min(100, Math.round(control.battery)));
    if (typeof control.obstacle === 'boolean') {
      this.obstacle = control.obstacle;
      if (control.obstacle) {
        this.target = null;
        this.telemetry.speed = 0;
        this.emit(UUIDS.event, { type: 'OBSTACLE_DETECTED', safetyInterlock: 'STOP' });
      }
    }
    if (control.errorMode) {
      for (const key of Object.keys(this.errorMode)) {
        if (Number.isFinite(control.errorMode[key])) this.errorMode[key] = Math.max(0, Math.min(1, control.errorMode[key]));
      }
    }
    if (control.disconnect === true) this.disconnected = true;
    if (control.disconnect === false) this.disconnected = false;
    this.emit(UUIDS.battery, Buffer.from([this.telemetry.battery]));
    this.emit(UUIDS.status, this.status());
  }

  tick() {
    if (this.disconnected) return;
    if (this.telemetry.battery > 0) this.telemetry.battery = Math.max(0, this.telemetry.battery - 0.002);
    if (this.target && !this.obstacle) {
      const latDelta = this.target.latitude - this.telemetry.latitude;
      const lngDelta = this.target.longitude - this.telemetry.longitude;
      const distance = Math.hypot(latDelta, lngDelta);
      if (distance < 0.000002) {
        this.telemetry.latitude = this.target.latitude;
        this.telemetry.longitude = this.target.longitude;
        this.telemetry.speed = 0;
        this.target = null;
        this.emit(UUIDS.event, { type: 'NAVIGATION_COMPLETE' });
      } else {
        const ratio = Math.min(0.08, 0.00002 / distance);
        this.telemetry.latitude += latDelta * ratio;
        this.telemetry.longitude += lngDelta * ratio;
        this.telemetry.heading = (Math.atan2(lngDelta, latDelta) * 180 / Math.PI + 360) % 360;
        this.telemetry.speed = 0.8;
      }
    }
    this.emit(UUIDS.telemetry, this.telemetry);
  }
}

function createRoboticsSimulator({ port = DEFAULT_PORT, host = DEFAULT_HOST, logger = console, initialRobots = 1 } = {}) {
  const server = new WebSocketServer({ port, host, maxPayload: 64 * 1024, perMessageDeflate: false });
  const robots = new Map();
  let robotSequence = 0;
  const send = (client, message) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  const spawn = () => {
    if (robots.size >= 3) throw new Error('Robot farm supports at most 3 robots');
    robotSequence += 1;
    const robot = new SimulatedRobot(`VL-ROBOT-${robotSequence}`, send, logger);
    robots.set(robot.id, robot);
    return robot;
  };
  for (let index = 0; index < Math.max(0, Math.min(3, initialRobots)); index += 1) spawn();
  const timer = setInterval(() => robots.forEach((robot) => robot.tick()), TELEMETRY_INTERVAL_MS);

  server.on('connection', (client) => {
    client._roboticsClientId = Math.random().toString(36).slice(2);
    client.on('message', (raw) => {
      let request;
      try {
        request = JSON.parse(raw.toString('utf8'));
        const respond = (result) => send(client, { id: request.id, ok: true, result });
        if (request.type === 'scan') return respond([...robots.values()].filter((robot) => !robot.disconnected).map((robot) => robot.definition()));
        if (request.type === 'spawn') return respond(spawn().definition());
        if (request.type === 'setRobotCount') {
          const count = Math.max(1, Math.min(3, Math.round(Number(request.count))));
          if (!Number.isFinite(count)) throw new Error('Robot count is invalid');
          while (robots.size < count) spawn();
          while (robots.size > count) {
            const robot = [...robots.values()].pop();
            for (const clientSocket of robot.subscriptions.keys()) {
              send(clientSocket, { type: 'disconnected', deviceId: robot.id, reason: 'farm_resized' });
            }
            robots.delete(robot.id);
          }
          return respond([...robots.values()].map((robot) => robot.definition()));
        }
        const robot = robots.get(request.deviceId);
        if (!robot) throw new Error('Robot not found');
        if (request.type === 'control') {
          robot.control(request.control);
          if (request.control?.disconnect) {
            send(client, { type: 'disconnected', deviceId: robot.id, reason: 'simulated_lost_connection' });
          }
          return respond(robot.definition());
        }
        if (robot.disconnected) throw new Error('Robot is disconnected');
        if (Math.random() < robot.errorMode.timeoutRate) return undefined;
        if (Math.random() < robot.errorMode.busyRate) throw Object.assign(new Error('Device busy'), { code: 'DEVICE_BUSY' });
        if (request.type === 'connect') return respond(robot.definition());
        if (request.type === 'discoverServices') return respond({ services: [UUIDS.service, UUIDS.roboticsService], characteristics: robot.characteristicDefinitions() });
        if (request.type === 'readCharacteristic') return respond({ value: encodeValue(robot.read(request.characteristicUUID)) });
        if (request.type === 'subscribe') {
          robot.subscribe(client, request.characteristicUUID);
          return respond({ subscribed: true });
        }
        if (request.type === 'writeCharacteristic') {
          if (Math.random() < robot.errorMode.invalidCRCRate) throw new Error('Command checksum is invalid');
          return respond(robot.acceptFragment(client, request));
        }
        throw new Error('Unsupported simulator operation');
      } catch (error) {
        send(client, { id: request?.id, ok: false, error: { code: error.code || 'SIMULATOR_ERROR', message: error.message } });
      }
    });
    client.on('close', () => robots.forEach((robot) => robot.subscriptions.delete(client)));
  });

  server.on('listening', () => logger.info?.(`[RoboticsSim] listening on ws://${host}:${server.address().port}`));
  const close = () => new Promise((resolve, reject) => {
    clearInterval(timer);
    for (const client of server.clients) client.terminate();
    server.close((error) => error ? reject(error) : resolve());
  });
  return { server, robots, spawn, close, uuids: UUIDS };
}

if (require.main === module) {
  createRoboticsSimulator({ port: Number(process.env.ROBOTICS_SIM_PORT || DEFAULT_PORT) });
}

module.exports = { UUIDS, SimulatedRobot, crc16, createCommandPacket, createRoboticsSimulator, parseCommandPacket };
