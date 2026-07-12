'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const {
  SAFETY_SYSTEM_PROMPT,
  createLocalCompanionResponse,
  getSafetyTips,
  hasImmediateDanger,
  inferScenario,
  latestToolResult,
  latestUserText,
  responseForToolResult,
  shouldRequestSafetyTips
} = require('./safety-companion.cjs');

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_PORT = 8787;
const HUME_API_BASE_URL = 'https://api.hume.ai';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envConfig(overrides = {}) {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    clmBearerToken: process.env.HUME_CLM_BEARER_TOKEN || '',
    humeApiKey: process.env.HUME_API_KEY || '',
    appAuthVerifyURL: process.env.APP_AUTH_VERIFY_URL || '',
    devAppToken: process.env.DEV_APP_TOKEN || '',
    upstreamURL: process.env.CLM_UPSTREAM_URL || '',
    upstreamApiKey: process.env.CLM_UPSTREAM_API_KEY || '',
    upstreamModel: process.env.CLM_UPSTREAM_MODEL || '',
    upstreamTimeoutMs: positiveNumber(process.env.CLM_UPSTREAM_TIMEOUT_MS, 25000),
    fetchImpl: globalThis.fetch,
    logger: console,
    ...overrides
  };
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return match?.[1] || '';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

function writeSSE(res, data) {
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function baseChunk(model, sessionId, id) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: sessionId || null
  };
}

function streamTextCompletion(res, { text, model, sessionId }) {
  openSSE(res);
  const id = `chatcmpl_${crypto.randomUUID().replaceAll('-', '')}`;
  writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  const chunks = [];
  for (let index = 0; index < text.length; index += 100) chunks.push(text.slice(index, index + 100));
  for (const content of chunks) {
    writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  }
  writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  writeSSE(res, '[DONE]');
  res.end();
}

function streamToolCall(res, { model, sessionId, scenario }) {
  openSSE(res);
  const id = `chatcmpl_${crypto.randomUUID().replaceAll('-', '')}`;
  const toolCallId = `call_${crypto.randomUUID().replaceAll('-', '')}`;
  writeSSE(res, {
    ...baseChunk(model, sessionId, id),
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: toolCallId,
          type: 'function',
          function: { name: 'get_safety_tips', arguments: JSON.stringify({ scenario }) }
        }]
      },
      finish_reason: null
    }]
  });
  writeSSE(res, { ...baseChunk(model, sessionId, id), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  writeSSE(res, '[DONE]');
  res.end();
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-100).flatMap((message) => {
    const role = message?.role || message?.message?.role;
    const content = typeof message?.content === 'string' ? message.content : message?.message?.content;
    if (!role || (typeof content !== 'string' && !message?.tool_calls)) return [];
    const normalized = { role, content: typeof content === 'string' ? content.slice(0, 12000) : null };
    if (message.name) normalized.name = message.name;
    if (message.tool_call_id) normalized.tool_call_id = message.tool_call_id;
    if (Array.isArray(message.tool_calls)) normalized.tool_calls = message.tool_calls;
    return [normalized];
  });
}

function hasSafetyTool(tools) {
  return Array.isArray(tools) && tools.some((tool) => tool?.function?.name === 'get_safety_tips' || tool?.name === 'get_safety_tips');
}

function sessionHash(sessionId) {
  return sessionId ? crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 12) : 'none';
}

async function pipeUpstreamSSE(upstreamResponse, res, sessionId) {
  openSSE(res);
  const reader = upstreamResponse.body?.getReader();
  if (!reader) throw new Error('Upstream response did not provide a readable stream');
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;

  const writeEvent = (event) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    if (!dataLines.length) return;
    const rawData = dataLines.map((line) => line.slice(5).trimStart()).join('\n');
    if (rawData === '[DONE]') {
      sawDone = true;
      writeSSE(res, '[DONE]');
      return;
    }
    try {
      const payload = JSON.parse(rawData);
      payload.system_fingerprint = sessionId || null;
      writeSSE(res, payload);
    } catch {
      // Ignore malformed upstream events instead of forwarding untrusted bytes.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    events.forEach(writeEvent);
    if (done) break;
  }
  if (buffer.trim()) writeEvent(buffer);
  if (!sawDone) writeSSE(res, '[DONE]');
  res.end();
}

async function callUpstream(body, config, res, sessionId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, config.upstreamTimeoutMs || 25000));
  const normalizedMessages = normalizeMessages(body.messages);
  const priorSystem = normalizedMessages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
  const messages = [
    { role: 'system', content: priorSystem ? `${SAFETY_SYSTEM_PROMPT}\n\nAdditional configured context:\n${priorSystem}` : SAFETY_SYSTEM_PROMPT },
    ...normalizedMessages.filter((message) => message.role !== 'system')
  ];
  const requestBody = {
    model: config.upstreamModel,
    messages,
    stream: true,
    temperature: 0.35,
    parallel_tool_calls: false
  };
  if (Array.isArray(body.tools)) requestBody.tools = body.tools;
  if (body.tool_choice) requestBody.tool_choice = body.tool_choice;

  try {
    const response = await config.fetchImpl(config.upstreamURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.upstreamApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Upstream returned no assistant content');
      streamTextCompletion(res, { text, model: config.upstreamModel, sessionId });
      return;
    }
    await pipeUpstreamSSE(response, res, sessionId);
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateApp(req, config) {
  const token = bearerToken(req);
  if (!token) return false;
  if (typeof config.verifyAppToken === 'function') return Boolean(await config.verifyAppToken(token));
  if (config.appAuthVerifyURL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await config.fetchImpl(config.appAuthVerifyURL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      return response.ok;
    } finally {
      clearTimeout(timeout);
    }
  }
  return config.nodeEnv !== 'production' && config.devAppToken && safeEqual(token, config.devAppToken);
}

function appAuthConfigured(config) {
  return typeof config.verifyAppToken === 'function' || Boolean(config.appAuthVerifyURL) || (config.nodeEnv !== 'production' && Boolean(config.devAppToken));
}

async function configureHumeSession(chatId, config) {
  if (!config.humeApiKey || !config.clmBearerToken) throw new Error('Hume control-plane secrets are not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await config.fetchImpl(`${HUME_API_BASE_URL}/v0/evi/chat/${encodeURIComponent(chatId)}/send`, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': config.humeApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'session_settings', language_model_api_key: config.clmBearerToken }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Hume control plane returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function createHandler(overrides = {}) {
  const config = envConfig(overrides);
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { status: 'ok', service: 'veryloving-hume-clm' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/chat/completions') {
        if (!config.clmBearerToken) {
          json(res, 503, { error: 'CLM authentication is not configured' });
          return;
        }
        if (!safeEqual(bearerToken(req), config.clmBearerToken)) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        const body = await readJson(req);
        if (!Array.isArray(body.messages)) {
          json(res, 400, { error: 'messages must be an array' });
          return;
        }
        const sessionId = url.searchParams.get('custom_session_id') || '';
        const model = body.model || 'veryloving-safety-clm';
        config.logger.info('[VeryLovingCLM] completion', { session: sessionHash(sessionId), messages: body.messages.length });

        const toolResult = latestToolResult(body.messages);
        const userText = latestUserText(body.messages);
        if (toolResult) {
          streamTextCompletion(res, { text: responseForToolResult(toolResult), model, sessionId });
          return;
        }
        if (hasImmediateDanger(userText)) {
          streamTextCompletion(res, { text: createLocalCompanionResponse(body.messages), model, sessionId });
          return;
        }
        if (shouldRequestSafetyTips(userText) && hasSafetyTool(body.tools)) {
          streamToolCall(res, { model, sessionId, scenario: inferScenario(userText) });
          return;
        }
        if (config.upstreamURL && config.upstreamApiKey && config.upstreamModel) {
          try {
            await callUpstream(body, config, res, sessionId);
            return;
          } catch (error) {
            config.logger.error('[VeryLovingCLM] upstream unavailable', { name: error.name });
            if (res.headersSent) {
              writeSSE(res, '[DONE]');
              res.end();
              return;
            }
          }
        }
        streamTextCompletion(res, { text: createLocalCompanionResponse(body.messages), model, sessionId });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/safety/tips') {
        if (!appAuthConfigured(config)) {
          json(res, 503, { error: 'Application authentication is not configured' });
          return;
        }
        if (!await authenticateApp(req, config)) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        const body = await readJson(req);
        json(res, 200, getSafetyTips(body.scenario));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/hume/session/configure') {
        if (!appAuthConfigured(config)) {
          json(res, 503, { error: 'Application authentication is not configured' });
          return;
        }
        if (!await authenticateApp(req, config)) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        const body = await readJson(req);
        if (!UUID_PATTERN.test(body.chatId || '')) {
          json(res, 400, { error: 'chatId must be a UUID' });
          return;
        }
        await configureHumeSession(body.chatId, config);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      json(res, 404, { error: 'Not found' });
    } catch (error) {
      config.logger.error('[VeryLovingCLM] request failed', { path: url.pathname, name: error.name });
      if (!res.headersSent) json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error' });
      else res.end();
    }
  };
}

function createVeryLovingCLMServer(options = {}) {
  const server = http.createServer(createHandler(options));
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  createVeryLovingCLMServer().listen(port, () => console.log(`[VeryLovingCLM] listening on ${port}`));
}

module.exports = {
  createHandler,
  createVeryLovingCLMServer,
  envConfig,
  normalizeMessages,
  safeEqual,
  streamTextCompletion,
  streamToolCall
};
