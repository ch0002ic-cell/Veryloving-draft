import { config } from '../utils/config';
import { cancelResponseBody, runBoundedRequest } from '../utils/bounded-http';

const SESSION_CONFIGURATION_TIMEOUT_MS = 7000;

function customizationURL(pathname) {
  return `${config.humeCustomizationURL.replace(/\/$/, '')}${pathname}`;
}

export async function configureHumeCustomSession(
  { chatId, customSessionId, accessToken },
  { fetchImpl = globalThis.fetch, timeoutMs = SESSION_CONFIGURATION_TIMEOUT_MS } = {}
) {
  if (!config.humeCLMEnabled) return;
  // The production WebSocket gateway injects the supplemental CLM key into
  // the first session_settings frame. Avoid a second chat-ID based control
  // plane request that cannot be ownership-bound across server instances.
  if (config.humeWSProxyURL) return;
  if (!chatId) throw new Error('Hume did not provide a chat ID.');
  if (!config.humeCustomizationURL) throw new Error('Voice customization is not configured for this build.');
  try {
    await runBoundedRequest(async ({ signal, captureResponse }) => {
      const response = await fetchImpl(customizationURL('/v1/hume/session/configure'), {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ chatId, customSessionId }),
        signal
      });
      captureResponse(response);
      await cancelResponseBody(response);
      if (!response.ok) throw new Error(`Voice session configuration failed (${response.status}).`);
    }, { timeoutMs });
  } catch (error) {
    if (error.code === 'HTTP_REQUEST_TIMEOUT') throw new Error('Voice customization timed out. Please try again.');
    throw error;
  }
}
