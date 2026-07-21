export const MAX_VOICE_TEXT_CHARACTERS = 4096;

export function normalizeVoiceText(value, { truncate = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= MAX_VOICE_TEXT_CHARACTERS) return text;
  if (truncate) return text.slice(0, MAX_VOICE_TEXT_CHARACTERS);
  const error = new Error(`Voice messages cannot exceed ${MAX_VOICE_TEXT_CHARACTERS} characters.`);
  error.code = 'VOICE_TEXT_TOO_LONG';
  throw error;
}
