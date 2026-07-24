import { VOICE_PROFILE_IDS } from '../constants/voice-profile-ids';
import { formatLocalizedDateTime } from './localized-format';

const KNOWN_VOICE_PROFILE_IDS = new Set(Object.values(VOICE_PROFILE_IDS));
const ROLE_TRANSLATION_KEYS = Object.freeze({
  assistant: 'history.roles.assistant',
  user: 'history.roles.user'
});
const MAX_STORED_VOICE_NAME_LENGTH = 80;

function safeStoredVoiceName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, MAX_STORED_VOICE_NAME_LENGTH).join('');
}

export function conversationCompanionName(session, translate) {
  const voiceId = typeof session?.voiceId === 'string' ? session.voiceId : null;
  if (voiceId && KNOWN_VOICE_PROFILE_IDS.has(voiceId)) {
    return translate(`voices.profiles.${voiceId}.name`);
  }
  return safeStoredVoiceName(session?.voiceName) || translate('history.aiCompanion');
}

export function conversationRoleLabel(role, translate) {
  const translationKey = typeof role === 'string' ? ROLE_TRANSLATION_KEYS[role] : null;
  return translate(translationKey || 'history.aiCompanion');
}

export function conversationTimestamp(session, locale) {
  return formatLocalizedDateTime(session?.updatedAt, locale)
    || formatLocalizedDateTime(session?.startedAt, locale);
}
