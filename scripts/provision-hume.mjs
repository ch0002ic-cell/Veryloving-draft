const HUME_API_BASE_URL = 'https://api.hume.ai';

const SAFETY_PROMPT = `You are VeryLoving, a warm personal-safety companion. Be calm, concise, emotionally attuned, and practical. Never claim an emergency action occurred unless a tool result confirms it. Encourage local emergency services when danger is immediate. Use get_safety_tips for non-urgent practical safety guidance.`;

const safetyTool = {
  name: 'get_safety_tips',
  description: 'Returns practical safety tips for the user current situation.',
  fallback_content: 'Safety tips are temporarily unavailable. Offer calm, general safety guidance instead.',
  version_description: 'Initial VeryLoving safety guidance tool.',
  parameters: JSON.stringify({
    type: 'object',
    additionalProperties: false,
    properties: {
      scenario: {
        type: 'string',
        enum: ['general', 'walking_alone', 'being_followed', 'rideshare', 'meeting_someone'],
        description: 'The safety scenario that best matches the user request.'
      }
    },
    required: ['scenario']
  })
};

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

async function provisionTool() {
  const existingId = process.env.HUME_TOOL_ID;
  const path = existingId ? `/v0/evi/tools/${existingId}` : '/v0/evi/tools';
  return humeRequest(path, { body: existingId ? { ...safetyTool, name: undefined } : safetyTool });
}

async function provisionConfig(tool) {
  const clmURL = new URL(required('HUME_CLM_URL'));
  if (clmURL.protocol !== 'https:' || !clmURL.pathname.endsWith('/chat/completions')) {
    throw new Error('HUME_CLM_URL must be HTTPS and end with /chat/completions');
  }
  const body = {
    evi_version: '3',
    name: 'VeryLoving Safety Companion',
    version_description: 'Safety-focused CLM, custom safety tips tool, and branded voice.',
    language_model: {
      model_provider: 'CUSTOM_LANGUAGE_MODEL',
      model_resource: clmURL.toString(),
      temperature: 0.35
    },
    prompt: { text: SAFETY_PROMPT },
    voice: voiceSpec(),
    tools: [{ id: tool.id, version: tool.version }],
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

const tool = await provisionTool();
const config = await provisionConfig(tool);
console.log(JSON.stringify({ toolId: tool.id, toolVersion: tool.version, configId: config.id, configVersion: config.version }, null, 2));
