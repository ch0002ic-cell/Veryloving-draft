import { normalizeLanguageCode } from '../i18n/core';

const REVIEWED_OFFLINE_LOCALES = new Set(['en', 'es', 'fr', 'zh']);

function freezeResponseSet(responses) {
  return Object.freeze(responses.map((response) => Object.freeze({
    ...response,
    scenarios: Object.freeze([...response.scenarios]),
    keywords: Object.freeze([...response.keywords])
  })));
}

const ENGLISH_RESPONSES = freezeResponseSet([
  { id: 'greeting-1', scenarios: ['generic', 'greeting'], keywords: ['hello', 'hi', 'hey'], text: 'I am here with you. What do you need right now?' },
  { id: 'safety-tips-1', scenarios: ['safety', 'tool-fallback'], keywords: ['safety tip', 'stay safe'], text: 'Stay in a well-lit public place, share your location with someone you trust, and keep emergency services ready if the danger is immediate.' },
  { id: 'safety-1', scenarios: ['safety'], keywords: ['unsafe', 'scared', 'danger', 'followed'], text: 'Let us get you somewhere visible and ready your emergency contacts.' },
  { id: 'support-1', scenarios: ['support'], keywords: ['sad', 'anxious', 'panic'], text: 'Breathe with me. In for four, hold, and out slowly.' },
  { id: 'encourage-1', scenarios: ['encourage'], keywords: ['help', 'can\'t', 'cannot', 'worried'], text: 'You are doing the right thing by checking in. I will stay with you.' },
  { id: 'generic-1', scenarios: ['generic'], keywords: [], text: 'This is offline companion mode. I can still help you think through your next safe step.' }
]);

export const offlineResponsesByLocale = Object.freeze({
  en: ENGLISH_RESPONSES,
  es: freezeResponseSet([
    { id: 'greeting-1', scenarios: ['generic', 'greeting'], keywords: ['hola', 'buenas'], text: 'Estoy aquí contigo. ¿Qué necesitas ahora?' },
    { id: 'safety-tips-1', scenarios: ['safety', 'tool-fallback'], keywords: ['consejo de seguridad', 'mantenerme a salvo', 'estar a salvo'], text: 'Quédate en un lugar público y bien iluminado, comparte tu ubicación con alguien de confianza y prepárate para llamar a emergencias si el peligro es inmediato.' },
    { id: 'safety-1', scenarios: ['safety'], keywords: ['inseguro', 'insegura', 'miedo', 'peligro', 'siguen', 'siguiendo'], text: 'Vayamos a un lugar visible y preparemos tus contactos de emergencia.' },
    { id: 'support-1', scenarios: ['support'], keywords: ['triste', 'ansiedad', 'ansioso', 'ansiosa', 'pánico'], text: 'Respira conmigo. Inhala durante cuatro segundos, mantén el aire y exhala lentamente.' },
    { id: 'encourage-1', scenarios: ['encourage'], keywords: ['ayuda', 'no puedo', 'preocupado', 'preocupada'], text: 'Hiciste bien en pedir ayuda. Me quedaré contigo.' },
    { id: 'generic-1', scenarios: ['generic'], keywords: [], text: 'Este es el modo acompañante sin conexión. Aún puedo ayudarte a pensar en tu próximo paso seguro.' }
  ]),
  fr: freezeResponseSet([
    { id: 'greeting-1', scenarios: ['generic', 'greeting'], keywords: ['bonjour', 'salut', 'coucou'], text: 'Je suis là avec vous. De quoi avez-vous besoin maintenant ?' },
    { id: 'safety-tips-1', scenarios: ['safety', 'tool-fallback'], keywords: ['conseil de sécurité', 'rester en sécurité', 'me protéger'], text: 'Restez dans un lieu public bien éclairé, partagez votre position avec une personne de confiance et préparez-vous à appeler les services d’urgence si le danger est immédiat.' },
    { id: 'safety-1', scenarios: ['safety'], keywords: ['pas en sécurité', 'peur', 'danger', 'suivi', 'suivie'], text: 'Allons dans un endroit visible et préparons vos contacts d’urgence.' },
    { id: 'support-1', scenarios: ['support'], keywords: ['triste', 'anxieux', 'anxieuse', 'panique'], text: 'Respirez avec moi. Inspirez pendant quatre secondes, retenez votre souffle, puis expirez lentement.' },
    { id: 'encourage-1', scenarios: ['encourage'], keywords: ['aide', 'je ne peux pas', 'inquiet', 'inquiète'], text: 'Vous avez bien fait de demander de l’aide. Je vais rester avec vous.' },
    { id: 'generic-1', scenarios: ['generic'], keywords: [], text: 'Le mode compagnon hors ligne est actif. Je peux toujours vous aider à réfléchir à la prochaine étape la plus sûre.' }
  ]),
  zh: freezeResponseSet([
    { id: 'greeting-1', scenarios: ['generic', 'greeting'], keywords: ['你好', '您好', '嗨'], text: '我在这里陪着你。你现在需要什么？' },
    { id: 'safety-tips-1', scenarios: ['safety', 'tool-fallback'], keywords: ['安全建议', '保持安全', '保护自己'], text: '请待在照明良好的公共场所，与可信任的人分享你的位置；如果眼前有危险，请立即联系紧急服务。' },
    { id: 'safety-1', scenarios: ['safety'], keywords: ['不安全', '害怕', '危险', '跟踪', '尾随'], text: '我们先去一个容易被人看见的地方，并准备好你的紧急联系人。' },
    { id: 'support-1', scenarios: ['support'], keywords: ['难过', '焦虑', '恐慌'], text: '跟我一起呼吸。吸气四秒，屏住呼吸，然后慢慢呼气。' },
    { id: 'encourage-1', scenarios: ['encourage'], keywords: ['帮助', '帮我', '做不到', '担心'], text: '你愿意求助是正确的。我会陪着你。' },
    { id: 'generic-1', scenarios: ['generic'], keywords: [], text: '现在是离线陪伴模式。我仍然可以陪你想一想，下一步怎样做会更安全。' }
  ])
});

// Backward-compatible English export for callers that inspect the fixture.
export const offlineResponses = ENGLISH_RESPONSES;

export function resolveOfflineResponseLocale(locale = 'en') {
  const candidate = typeof locale === 'string'
    ? locale
    : typeof locale?.languageTag === 'string'
      ? locale.languageTag
      : typeof locale?.languageCode === 'string'
        ? [
            locale.languageCode,
            typeof locale.scriptCode === 'string' ? locale.scriptCode : '',
            typeof locale.regionCode === 'string' ? locale.regionCode : ''
          ].filter(Boolean).join('-')
        : '';
  // Reuse the app's script-aware locale boundary. In particular, a
  // Traditional-Chinese OS tag must not be collapsed into the shipped
  // Simplified-Chinese response set.
  const language = normalizeLanguageCode(candidate);
  // The 151 machine-QA catalogs deliberately receive reviewed English copy
  // until their offline safety wording has completed native-speaker review.
  return REVIEWED_OFFLINE_LOCALES.has(language) ? language : 'en';
}

export function chooseOfflineResponse(input = '', locale = 'en') {
  const responseLocale = resolveOfflineResponseLocale(locale);
  const responses = offlineResponsesByLocale[responseLocale];
  const normalizedInput = typeof input === 'string'
    ? input.normalize('NFKC').toLocaleLowerCase(responseLocale)
    : '';
  return responses.find(
    (item) => item.keywords.some((keyword) => normalizedInput.includes(keyword))
  ) || responses[responses.length - 1];
}
