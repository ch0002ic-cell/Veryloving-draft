import { config } from '../utils/config';
import {
  localSafetyToolResult,
  parseSafetyToolParameters,
  SAFETY_TIPS_TOOL_NAME
} from './hume-tool-utils';

const TOOL_TIMEOUT_MS = 8000;

function linkAbortSignal(controller, signal) {
  if (!signal) return () => {};
  if (signal.aborted) controller.abort();
  const abort = () => controller.abort();
  signal.addEventListener?.('abort', abort, { once: true });
  return () => signal.removeEventListener?.('abort', abort);
}

export async function executeHumeTool(toolCall, { accessToken, signal } = {}) {
  if (toolCall?.name !== SAFETY_TIPS_TOOL_NAME) throw new Error(`Unsupported Hume tool: ${toolCall?.name || 'unknown'}`);
  const { scenario } = parseSafetyToolParameters(toolCall.parameters);
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    const baseURL = config.humeCustomizationURL.replace(/\/$/, '');
    const response = await fetch(`${baseURL}/v1/safety/tips`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify({ scenario }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Safety tips service returned ${response.status}.`);
    const result = await response.json();
    if (!Array.isArray(result?.tips) || !result.tips.length) throw new Error('Safety tips service returned an invalid response.');
    return JSON.stringify({ ...result, scenario, source: 'veryloving_backend' });
  } catch (error) {
    if (signal?.aborted) throw error;
    return JSON.stringify(localSafetyToolResult(scenario));
  } finally {
    unlink();
    clearTimeout(timeout);
  }
}

export { SAFETY_TIPS_TOOL_NAME };
