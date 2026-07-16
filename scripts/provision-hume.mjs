import { HUME_TOOL_SPECS, VERYLOVING_PROMPT } from './hume-tool-definitions.mjs';

const HUME_API_BASE_URL = 'https://api.hume.ai';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function humeRequest(path, { method = 'POST', body } = {}) {
  const response = await fetch(`${HUME_API_BASE_URL}${path}`, {
    method,
    headers: {
      'X-Hume-Api-Key': required('HUME_API_KEY'),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Hume ${method} ${path} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

function voiceSpec() {
  if (process.env.HUME_CUSTOM_VOICE_ID) {
    return { provider: 'CUSTOM_VOICE', id: process.env.HUME_CUSTOM_VOICE_ID };
  }
  return { provider: 'HUME_AI', name: process.env.HUME_VOICE_NAME || 'Serene Assistant' };
}

async function provisionTool(spec) {
  const existingId = process.env[spec.environmentVariable]
    || (spec.legacyEnvironmentVariable ? process.env[spec.legacyEnvironmentVariable] : undefined);
  const path = existingId ? `/v0/evi/tools/${existingId}` : '/v0/evi/tools';
  const definition = spec.definition;
  return humeRequest(path, { body: existingId ? { ...definition, name: undefined } : definition });
}

async function provisionTools() {
  const tools = [];
  for (const spec of HUME_TOOL_SPECS) tools.push(await provisionTool(spec));
  return tools;
}

async function provisionConfig(tools) {
  const clmURL = new URL(required('HUME_CLM_URL'));
  if (clmURL.protocol !== 'https:' || !clmURL.pathname.endsWith('/chat/completions')) {
    throw new Error('HUME_CLM_URL must be HTTPS and end with /chat/completions');
  }
  const body = {
    evi_version: '3',
    name: 'VeryLoving Robotics Safety Companion',
    version_description: 'Safety-focused CLM, signed robotics tools, safety tips, and branded voice.',
    language_model: {
      model_provider: 'CUSTOM_LANGUAGE_MODEL',
      model_resource: clmURL.toString(),
      temperature: 0.35
    },
    prompt: { text: VERYLOVING_PROMPT },
    voice: voiceSpec(),
    tools: tools.map((tool) => ({ id: tool.id, version: tool.version })),
    ellm_model: { allow_short_responses: false },
    event_messages: { on_new_chat: { enabled: false } },
    timeouts: {
      inactivity: { enabled: true, duration_secs: 300 },
      max_duration: { enabled: true, duration_secs: 1800 }
    }
  };
  const existingId = process.env.HUME_CONFIG_ID;
  if (existingId) delete body.name;
  return humeRequest(existingId ? `/v0/evi/configs/${existingId}` : '/v0/evi/configs', { body });
}

const tools = await provisionTools();
const config = await provisionConfig(tools);
console.log(JSON.stringify({
  tools: tools.map((tool) => ({ name: tool.name, id: tool.id, version: tool.version })),
  configId: config.id,
  configVersion: config.version
}, null, 2));
