'use strict';

const crypto = require('node:crypto');

const DEVICE_TYPES = new Set(['wearable', 'home_robot']);
const ACTIONS = Object.freeze({
  deploy_barrier: new Set(['wearable']),
  trigger_sos: new Set(['wearable']),
  check_medication: new Set(['home_robot']),
  medication_reminder: new Set(['home_robot']),
  cognitive_engagement: new Set(['home_robot'])
});

function redactSerial(serial) {
  if (!serial) return '[redacted]';
  return `serial_${crypto.createHash('sha256').update(String(serial)).digest('hex').slice(0, 10)}`;
}

function validateAction(input) {
  const action = typeof input?.action === 'string' ? input.action : '';
  const deviceType = input?.device_type;
  if (!ACTIONS[action] || !DEVICE_TYPES.has(deviceType) || !ACTIONS[action].has(deviceType)) {
    throw Object.assign(new Error('Action is not allowed for this device type'), { statusCode: 400 });
  }
  const deviceId = typeof input.device_id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(input.device_id)
    ? input.device_id : null;
  if (!deviceId) throw Object.assign(new Error('device_id is invalid'), { statusCode: 400 });
  const parameters = input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
    ? input.parameters : {};
  if (Buffer.byteLength(JSON.stringify(parameters)) > 16 * 1024) {
    throw Object.assign(new Error('Action parameters are too large'), { statusCode: 413 });
  }
  return { action, device_type: deviceType, device_id: deviceId, parameters };
}

function signEnvelope(action, secret, now = Date.now) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('ACTION_SIGNING_SECRET is not configured');
  const envelope = { version: 1, id: crypto.randomUUID(), issued_at: now(), ...action };
  const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { envelope, signature, algorithm: 'HS256' };
}

class ActionGateway {
  constructor({ signingSecret, manufacturerWebhookURL, manufacturerApiKey, fetchImpl = globalThis.fetch, retries = 3, retryDelayMs = 500, sleep, logger = console } = {}) {
    this.signingSecret = signingSecret;
    this.manufacturerWebhookURL = manufacturerWebhookURL;
    this.manufacturerApiKey = manufacturerApiKey;
    this.fetchImpl = fetchImpl;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = logger;
    this.sessions = new Map();
  }

  registerSession(userId, channel, devices = []) {
    const session = { channel, devices: new Map(devices.map((device) => [device.device_id, device])) };
    this.sessions.set(userId, session);
    return () => { if (this.sessions.get(userId) === session) this.sessions.delete(userId); };
  }

  async route(userId, input) {
    const action = validateAction(input);
    const session = this.sessions.get(userId);
    const device = session?.devices.get(action.device_id);
    if (!device || device.device_type !== action.device_type || device.online !== true) {
      throw Object.assign(new Error('Requested device is offline'), { statusCode: 409 });
    }
    const signed = signEnvelope(action, this.signingSecret);
    if (action.device_type === 'wearable') {
      if (!session.channel || session.channel.readyState !== 1) throw Object.assign(new Error('Wearable channel is unavailable'), { statusCode: 409 });
      session.channel.send(JSON.stringify({ type: 'device_action', ...signed }));
      return { status: 'delivered', action_id: signed.envelope.id };
    }
    this.deliverRobot(signed).catch((error) => this.logger.error('[ActionGateway] Robot delivery exhausted', {
      actionId: signed.envelope.id, name: error?.name || 'DeliveryError'
    }));
    return { status: 'accepted', action_id: signed.envelope.id };
  }

  async deliverRobot(signed) {
    if (!this.manufacturerWebhookURL || !this.manufacturerApiKey) throw new Error('Manufacturer gateway is not configured');
    let lastError;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.manufacturerWebhookURL, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': this.manufacturerApiKey }, body: JSON.stringify(signed)
        });
        if (response.status !== 202 && !response.ok) throw new Error(`Manufacturer returned ${response.status}`);
        return { acknowledged: response.status !== 202, status: response.status };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < this.retries) await this.sleep(this.retryDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  }
}

module.exports = { ACTIONS, ActionGateway, redactSerial, signEnvelope, validateAction };
