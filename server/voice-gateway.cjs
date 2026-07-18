'use strict';

const { WebSocket, WebSocketServer } = require('ws');
const { verifySessionJWT } = require('./auth-session.cjs');
const { ACTION_TOOL_SCHEMAS } = require('./device-action-tools.cjs');
const { VOICE_LOCALES: VOICE_LOCALE_CODES } = require('./voice-locales.cjs');

const GATEWAY_PATH = '/api/voice/hume-ws';
const HUME_WS_URL = 'wss://api.hume.ai/v0/evi/chat';
const AUTH_TIMEOUT_MS = 10000;
const MAX_CLIENT_PAYLOAD_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 512 * 1024;
const HUME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSONA_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const VOICE_LOCALES = new Set(VOICE_LOCALE_CODES);

function boundedString(value, maxLength) {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function normalizeVoiceLocale(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/_/g, '-').toLowerCase();
  return VOICE_LOCALES.has(normalized) ? normalized : undefined;
}

function parsePersonaMap(value) {
  if (!value) return new Map();
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('HUME_PERSONA_MAP_JSON must be valid JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('HUME_PERSONA_MAP_JSON must be an object');
  }
  const personas = new Map();
  for (const [personaId, definition] of Object.entries(parsed)) {
    const voiceId = definition?.voice_id;
    const instructions = definition?.instructions;
    if (!PERSONA_ID_PATTERN.test(personaId) || !HUME_ID_PATTERN.test(String(voiceId || ''))) {
      throw new Error('HUME_PERSONA_MAP_JSON contains an invalid persona or voice ID');
    }
    if (instructions !== undefined && (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 500)) {
      throw new Error('HUME_PERSONA_MAP_JSON persona instructions are invalid');
    }
    personas.set(personaId, {
      voiceId,
      instructions: instructions?.trim()
    });
  }
  return personas;
}

function configuredPersonaMap(config) {
  if (config.humePersonaMap instanceof Map) return config.humePersonaMap;
  return parsePersonaMap(config.humePersonaMapJSON || process.env.HUME_PERSONA_MAP_JSON || '');
}

function configuredDefaultPersona(config) {
  return config.humeDefaultPersonaId || process.env.HUME_DEFAULT_PERSONA_ID || undefined;
}

function assertVoicePersonaConfig(config) {
  const personas = configuredPersonaMap(config);
  if (config.nodeEnv !== 'production') return personas;
  if (!personas.size) throw new Error('HUME_PERSONA_MAP_JSON is required in production');
  const defaultPersonaId = configuredDefaultPersona(config);
  if (!defaultPersonaId || !personas.has(defaultPersonaId)) {
    throw new Error('HUME_DEFAULT_PERSONA_ID must select a configured persona in production');
  }
  const allowedVoices = new Set(String(config.humeAllowedVoiceIds || '').split(',').map((item) => item.trim()).filter(Boolean));
  if ([...personas.values()].some((persona) => !allowedVoices.has(persona.voiceId))) {
    throw new Error('Every configured persona voice must be present in HUME_ALLOWED_VOICE_IDS');
  }
  return personas;
}

function resolveVoiceSession(auth, config) {
  const personas = configuredPersonaMap(config);
  const personaId = auth.personaId || configuredDefaultPersona(config);
  const locale = auth.locale || 'en';
  if (!personas.size) return { ...auth, locale, personaId };
  const persona = personas.get(personaId);
  if (!persona) throw new Error('The requested voice persona is not allowed');
  if (auth.voiceId && auth.voiceId !== persona.voiceId) {
    throw new Error('Direct voice overrides are not allowed with a voice persona');
  }
  return {
    ...auth,
    locale,
    personaId,
    voiceId: persona.voiceId,
    personaInstructions: persona.instructions
  };
}

function parseVoiceAuthenticationMessage(raw) {
  let message;
  try {
    message = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    throw new Error('Voice authentication message must be valid JSON');
  }
  if (
    message?.type !== 'authenticate'
    || typeof message.access_token !== 'string'
    || !message.access_token
    || message.access_token.length > 20000
  ) {
    throw new Error('Voice authentication is required');
  }
  const connection = message.connection && typeof message.connection === 'object' ? message.connection : {};
  const configId = boundedString(connection.config_id, 200);
  const voiceId = boundedString(connection.voice_id, 200);
  const personaId = boundedString(connection.persona_id, 40);
  const rawLocale = boundedString(connection.locale, 35);
  const locale = normalizeVoiceLocale(rawLocale);
  const resumedChatGroupId = boundedString(connection.resumed_chat_group_id, 200);
  const devices = normalizeDevices(connection.devices);
  if (
    configId === null
    || voiceId === null
    || personaId === null
    || (personaId !== undefined && !PERSONA_ID_PATTERN.test(personaId))
    || rawLocale === null
    || (rawLocale !== undefined && !locale)
    || resumedChatGroupId === null
  ) {
    throw new Error('Voice connection parameters are invalid');
  }
  return {
    accessToken: message.access_token,
    configId,
    voiceId,
    personaId,
    locale,
    resumedChatGroupId,
    devices
  };
}

function hasScope(claims, required) {
  const scopes = new Set(String(claims?.scope || '').split(/\s+/).filter(Boolean));
  return scopes.has(required);
}

function normalizeDevices(devices) {
  return Array.isArray(devices) ? devices.slice(0, 20).flatMap((device) => {
    const deviceId = boundedString(device?.device_id, 128);
    if (!deviceId || !['wearable', 'home_robot'].includes(device?.device_type)) return [];
    return [{ device_id: deviceId, device_type: device.device_type, online: device.online === true }];
  }) : [];
}

function prepareUpstreamMessage(data, isBinary, config) {
  if (isBinary) return { payload: data, binary: true };
  const text = typeof data === 'string' ? data : data.toString('utf8');
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return { payload: text, binary: false };
  }
  if (message?.type !== 'session_settings') return { payload: text, binary: false };

  const sanitized = { ...message };
  // Supplemental model credentials are owned by the gateway. A client may
  // never provide or replace them.
  delete sanitized.language_model_api_key;
  if (config.clmBearerToken) sanitized.language_model_api_key = config.clmBearerToken;
  if (config.nodeEnv === 'production') {
    // Production behavior, tools, and prompts are versioned in the approved
    // Hume config rather than being overridable by a modified mobile client.
    delete sanitized.system_prompt;
    delete sanitized.tools;
    delete sanitized.builtin_tools;
    delete sanitized.context;
    delete sanitized.variables;
  }
  const voiceSession = config.voiceSession || {};
  const sessionVariables = config.nodeEnv === 'production'
    ? {}
    : { ...(sanitized.variables && typeof sanitized.variables === 'object' ? sanitized.variables : {}) };
  delete sessionVariables.veryloving_locale;
  delete sessionVariables.veryloving_persona;
  sessionVariables.veryloving_locale = voiceSession.locale || 'en';
  if (voiceSession.personaId) sessionVariables.veryloving_persona = voiceSession.personaId;
  sanitized.variables = sessionVariables;
  if (config.nodeEnv === 'production') {
    const personaInstruction = voiceSession.personaInstructions
      ? ` Persona style: ${voiceSession.personaInstructions}`
      : '';
    sanitized.context = {
      type: 'persistent',
      text: `Respond in the user's interface language (${voiceSession.locale || 'en'}) unless the user explicitly requests another language.${personaInstruction}`
    };
  }
  // Device actions are always server-owned. This makes the deployed runtime
  // independent of a mutable, out-of-band Hume dashboard configuration.
  if (config.actionGateway) sanitized.tools = ACTION_TOOL_SCHEMAS;
  return { payload: JSON.stringify(sanitized), binary: false };
}

function buildHumeUpstreamURL(auth, config) {
  if (!config.humeApiKey) throw new Error('Hume gateway credentials are not configured');
  const voiceSession = config.voiceSessionResolved ? auth : resolveVoiceSession(auth, config);
  const configuredId = config.humeConfigId || voiceSession.configId;
  if (config.humeConfigId && voiceSession.configId && voiceSession.configId !== config.humeConfigId) {
    throw new Error('The requested Hume configuration is not allowed');
  }
  const allowedVoices = new Set(String(config.humeAllowedVoiceIds || '').split(',').map((item) => item.trim()).filter(Boolean));
  if (allowedVoices.size && voiceSession.voiceId && !allowedVoices.has(voiceSession.voiceId)) {
    throw new Error('The requested Hume voice is not allowed');
  }
  if (voiceSession.resumedChatGroupId && !config.humeAllowClientResume) {
    throw new Error('Voice session resume is not enabled');
  }
  const url = new URL(HUME_WS_URL);
  url.searchParams.set('api_key', config.humeApiKey);
  if (configuredId) url.searchParams.set('config_id', configuredId);
  if (voiceSession.voiceId) url.searchParams.set('voice_id', voiceSession.voiceId);
  if (voiceSession.resumedChatGroupId) url.searchParams.set('resumed_chat_group_id', voiceSession.resumedChatGroupId);
  return url.toString();
}

function closeSocket(socket, code, reason) {
  if (!socket || (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING)) return;
  try {
    socket.close(code, reason.slice(0, 120));
  } catch {
    try { socket.terminate?.(); } catch {}
  }
}

function attachVoiceGateway(server, config) {
  const humePersonaMap = assertVoicePersonaConfig(config);
  const gateway = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_PAYLOAD_BYTES, perMessageDeflate: false });

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== GATEWAY_PATH) {
      socket.destroy();
      return;
    }
    gateway.handleUpgrade(request, socket, head, (client) => gateway.emit('connection', client, request));
  });

  gateway.on('connection', (client) => {
    let upstream = null;
    let authenticated = false;
    let authenticating = false;
    let closed = false;
    let sessionExpiryTimer = null;
    let unregisterActionSession = null;
    let principal = null;
    let voiceSession = null;
    const authTimer = setTimeout(() => closeSocket(client, 4001, 'authentication timeout'), AUTH_TIMEOUT_MS);

    const cleanup = () => {
      if (!closed) {
        closed = true;
        clearTimeout(authTimer);
        clearTimeout(sessionExpiryTimer);
      }
      unregisterActionSession?.();
      unregisterActionSession = null;
      if (upstream) {
        const socketToClose = upstream;
        upstream = null;
        closeSocket(socketToClose, 1000, 'client disconnected');
      }
    };

    client.on('message', (data, isBinary) => {
      if (!authenticated) {
        // Only one first-frame ceremony is allowed. Without this guard, two
        // frames arriving before token verification completes can open two
        // upstream Hume sockets and race the authenticated state.
        if (authenticating || isBinary) {
          closeSocket(client, 4001, 'invalid authentication sequence');
          return;
        }
        authenticating = true;
        Promise.resolve().then(async () => {
          const auth = parseVoiceAuthenticationMessage(data);
          const claims = typeof config.verifyVoiceToken === 'function'
            ? await config.verifyVoiceToken(auth.accessToken)
            : verifySessionJWT(auth.accessToken, config);
          if (!claims || !hasScope(claims, 'voice:connect')) throw new Error('Voice session is unauthorized');
          if (closed || client.readyState !== WebSocket.OPEN) return;
          const expiresInMs = Number(claims.exp) * 1000 - Date.now();
          if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) throw new Error('Voice session has expired');
          sessionExpiryTimer = setTimeout(() => {
            closeSocket(client, 4001, 'voice session expired');
          }, Math.min(expiresInMs, 2147483647));
          voiceSession = resolveVoiceSession(auth, { ...config, humePersonaMap });
          const upstreamURL = buildHumeUpstreamURL(voiceSession, {
            ...config,
            humePersonaMap,
            voiceSessionResolved: true
          });
          const createUpstream = config.createUpstreamWebSocket || ((url) => new WebSocket(url, {
            handshakeTimeout: AUTH_TIMEOUT_MS,
            maxPayload: MAX_CLIENT_PAYLOAD_BYTES,
            perMessageDeflate: false
          }));
          upstream = createUpstream(upstreamURL);
          upstream.on('open', () => {
            if (client.readyState !== WebSocket.OPEN) return cleanup();
            authenticated = true;
            authenticating = false;
            principal = claims;
            clearTimeout(authTimer);
            unregisterActionSession = config.actionGateway?.registerSession(claims.sub, client, auth.devices);
            client.send(JSON.stringify({ type: 'auth_ok' }));
          });
          upstream.on('message', (payload, upstreamBinary) => {
            if (client.readyState !== WebSocket.OPEN) return;
            if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
              closeSocket(client, 4000, 'client backpressure limit');
              return;
            }
            client.send(payload, { binary: upstreamBinary });
          });
          upstream.on('error', () => closeSocket(client, 1011, 'voice upstream unavailable'));
          upstream.on('close', (code, reason) => {
            closeSocket(client, Number(code) || 1011, reason?.toString() || 'voice upstream closed');
          });
        }).catch((error) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'auth_error' }));
          }
          config.logger?.warn?.('[VoiceGateway] Authentication rejected', {
            name: error?.name || 'VoiceAuthenticationError'
          });
          closeSocket(client, 4001, 'voice authentication failed');
        });
        return;
      }

      if (!isBinary) {
        let message;
        try { message = JSON.parse(typeof data === 'string' ? data : data.toString('utf8')); } catch {}
        if (message?.type === 'devices_update') {
          const devices = normalizeDevices(message.devices);
          config.actionGateway?.updateSessionDevices?.(principal?.sub, client, devices);
          client.send(JSON.stringify({ type: 'devices_updated', count: devices.length }));
          return;
        }
        if (message?.type === 'device_action_ack') {
          config.actionGateway?.acknowledgeWearable?.(principal?.sub, client, message);
          return;
        }
        if (message?.type === 'action_request') {
          const requestId = boundedString(message.request_id, 128);
          if (!requestId || !/^[A-Za-z0-9._:-]+$/.test(requestId) || !config.actionGateway) {
            client.send(JSON.stringify({ type: 'action_response', request_id: requestId || 'invalid', ok: false, status: config.actionGateway ? 400 : 503 }));
            return;
          }
          Promise.resolve(config.actionGateway.route(principal.sub, {
            ...message,
            idempotency_key: requestId
          })).then((result) => {
            if (!closed && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'action_response', request_id: requestId, ok: true, result }));
            }
          }).catch((error) => {
            if (!closed && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'action_response',
                request_id: requestId,
                ok: false,
                status: Number(error?.statusCode) || 500,
                error_code: error?.code || 'DEVICE_ACTION_FAILED'
              }));
            }
          });
          return;
        }
      }

      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
      if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
        closeSocket(client, 4000, 'upstream backpressure limit');
        return;
      }
      const outbound = prepareUpstreamMessage(data, isBinary, { ...config, voiceSession });
      upstream.send(outbound.payload, { binary: outbound.binary });
    });

    client.on('error', cleanup);
    client.on('close', cleanup);
  });

  return gateway;
}

module.exports = {
  GATEWAY_PATH,
  attachVoiceGateway,
  assertVoicePersonaConfig,
  buildHumeUpstreamURL,
  hasScope,
  normalizeVoiceLocale,
  parsePersonaMap,
  parseVoiceAuthenticationMessage,
  prepareUpstreamMessage,
  resolveVoiceSession
};
