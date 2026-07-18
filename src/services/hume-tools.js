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

export async function executeHumeTool(toolCall, {
  accessToken,
  signal,
  requestDeviceAction,
  requestHelpDial
} = {}) {
  if (toolCall?.name === 'request_help_dial') {
    if (typeof requestHelpDial !== 'function') throw new Error('The emergency help flow is unavailable.');
    const result = await requestHelpDial({ signal });
    return JSON.stringify({
      status: result?.status || 'unknown',
      backend_status: result?.backendStatus || 'disabled'
    });
  }
  if (['deploy_barrier', 'emit_alarm', 'stop', 'check_medication'].includes(toolCall?.name)) {
    let parameters;
    try { parameters = typeof toolCall.parameters === 'string' ? JSON.parse(toolCall.parameters) : toolCall.parameters; } catch { throw new Error('Device action parameters were invalid.'); }
    if (typeof requestDeviceAction === 'function') {
      return requestDeviceAction({ ...toolCall, parameters }, { signal });
    }
    if (!accessToken || !config.apiBaseUrl) throw new Error('Connected device actions are unavailable.');
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/v1/device-actions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: toolCall.name, ...parameters }),
      signal
    });
    if (!response.ok) throw new Error(`Device action service returned ${response.status}.`);
    return JSON.stringify(await response.json());
  }
  if (toolCall?.name !== SAFETY_TIPS_TOOL_NAME) throw new Error(`Unsupported Hume tool: ${toolCall?.name || 'unknown'}`);
  const { scenario } = parseSafetyToolParameters(toolCall.parameters);
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    if (!config.humeCustomizationURL) return JSON.stringify(localSafetyToolResult(scenario));
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
