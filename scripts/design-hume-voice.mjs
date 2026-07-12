import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HUME_API_BASE_URL = 'https://api.hume.ai';
const VOICE_NAME = 'VeryLoving Warm Guardian';
const SAMPLE_TEXT = "I'm right here with you. Let's take one calm step at a time and get you somewhere safe.";
const VOICE_DESCRIPTION = 'A warm, grounded adult voice for a personal safety companion. Reassuring without sounding clinical, protective without sounding controlling, with clear diction, a calm medium pace, gentle confidence, and natural emotional warmth. The speaker sounds fully present during a stressful moment and leaves small, comfortable pauses between practical steps.';

function apiKey() {
  if (!process.env.HUME_API_KEY) throw new Error('HUME_API_KEY is required');
  return process.env.HUME_API_KEY;
}

async function request(pathname, body) {
  const response = await fetch(`${HUME_API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Hume voice request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function generate(outputDirectory) {
  const payload = await request('/v0/tts', {
    version: '1',
    num_generations: 3,
    utterances: [{ text: SAMPLE_TEXT, description: VOICE_DESCRIPTION }]
  });
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    requestId: payload.request_id,
    voiceName: VOICE_NAME,
    description: VOICE_DESCRIPTION,
    sampleText: SAMPLE_TEXT,
    generations: []
  };
  for (const [index, generation] of (payload.generations || []).entries()) {
    const extension = generation.encoding?.format || 'mp3';
    const filename = `veryloving-voice-${index + 1}.${extension}`;
    await writeFile(path.join(outputDirectory, filename), Buffer.from(generation.audio, 'base64'));
    manifest.generations.push({ generationId: generation.generation_id, filename, duration: generation.duration });
  }
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${manifest.generations.length} voice candidates in ${outputDirectory}`);
}

async function save(generationId, name) {
  if (!generationId) throw new Error('A generation ID is required for save');
  const voice = await request('/v0/tts/voices', { generation_id: generationId, name: name || VOICE_NAME });
  console.log(JSON.stringify({ id: voice.id, name: voice.name }, null, 2));
}

const [command = 'generate', firstArg, secondArg] = process.argv.slice(2);
if (command === 'generate') await generate(path.resolve(firstArg || 'artifacts/hume-voice'));
else if (command === 'save') await save(firstArg, secondArg);
else throw new Error('Usage: node scripts/design-hume-voice.mjs generate [output-dir] | save <generation-id> [voice-name]');
