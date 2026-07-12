import { config } from '../utils/config';

const SESSION_CONFIGURATION_TIMEOUT_MS = 7000;

function customizationURL(pathname) {
  return `${config.humeCustomizationURL.replace(/\/$/, '')}${pathname}`;
}

export async function configureHumeCustomSession({ chatId, customSessionId, accessToken }) {
  if (!config.humeCLMEnabled) return;
  if (!chatId) throw new Error('Hume did not provide a chat ID.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SESSION_CONFIGURATION_TIMEOUT_MS);
  try {
    const response = await fetch(customizationURL('/v1/hume/session/configure'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify({ chatId, customSessionId }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Voice session configuration failed (${response.status}).`);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Voice customization timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
