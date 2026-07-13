export const offlineResponses = [
  { id: 'greeting-1', scenarios: ['generic', 'greeting'], keywords: ['hello', 'hi', 'hey'], text: 'I am here with you. What do you need right now?' },
  { id: 'safety-tips-1', scenarios: ['safety', 'tool-fallback'], keywords: ['safety tip', 'stay safe'], text: 'Stay in a well-lit public place, share your location with someone you trust, and keep emergency services ready if the danger is immediate.' },
  { id: 'safety-1', scenarios: ['safety'], keywords: ['unsafe', 'scared', 'danger', 'followed'], text: 'Let us get you somewhere visible and ready your emergency contacts.' },
  { id: 'support-1', scenarios: ['support'], keywords: ['sad', 'anxious', 'panic'], text: 'Breathe with me. In for four, hold, and out slowly.' },
  { id: 'encourage-1', scenarios: ['encourage'], keywords: ['help', 'can\'t', 'worried'], text: 'You are doing the right thing by checking in. I will stay with you.' },
  { id: 'generic-1', scenarios: ['generic'], keywords: [], text: 'This is offline companion mode. I can still help you think through your next safe step.' }
];

export function chooseOfflineResponse(input = '') {
  const lower = input.toLowerCase();
  return offlineResponses.find((item) => item.keywords.some((keyword) => lower.includes(keyword))) || offlineResponses[offlineResponses.length - 1];
}
