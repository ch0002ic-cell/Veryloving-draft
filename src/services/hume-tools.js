import { config } from '../utils/config';
import {
  localSafetyToolResult,
  parseSafetyToolParameters,
  SAFETY_TIPS_TOOL_NAME
} from './hume-tool-utils';
import { cancelResponseBody, readBoundedJSONResponse, runBoundedRequest } from '../utils/bounded-http';

const TOOL_TIMEOUT_MS = 8000;
const AI_ANGEL_TOOL_NAME = 'trigger_ai_angel';

export async function executeHumeTool(toolCall, {
  accessToken,
  signal,
  requestDeviceAction,
  requestAINativeScenario,
  requestHelpDial,
  fetchImpl = globalThis.fetch,
  timeoutMs = TOOL_TIMEOUT_MS
} = {}) {
  if (toolCall?.name === 'request_help_dial') {
    if (typeof requestHelpDial !== 'function') throw new Error('The emergency help flow is unavailable.');
    const result = await requestHelpDial({ signal });
    return JSON.stringify({
      status: result?.status || 'unknown',
      backend_status: result?.backendStatus || 'disabled'
    });
  }
  if (toolCall?.name === AI_ANGEL_TOOL_NAME) {
    let parameters;
    try { parameters = typeof toolCall.parameters === 'string' ? JSON.parse(toolCall.parameters) : (toolCall.parameters ?? {}); } catch {
      throw new Error('AI Angel parameters were invalid.');
    }
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || Object.keys(parameters).length) {
      throw new Error('AI Angel does not accept device identifiers or action parameters.');
    }
    const startScenario = requestAINativeScenario || requestDeviceAction;
    if (typeof startScenario !== 'function') throw new Error('The AI Angel scenario gateway is unavailable.');
    return startScenario({ ...toolCall, parameters: {} }, { signal });
  }
  if (['deploy_barrier', 'emit_alarm', 'stop', 'check_medication'].includes(toolCall?.name)) {
    let parameters;
    try { parameters = typeof toolCall.parameters === 'string' ? JSON.parse(toolCall.parameters) : toolCall.parameters; } catch { throw new Error('Device action parameters were invalid.'); }
    if (typeof requestDeviceAction === 'function') {
      return requestDeviceAction({ ...toolCall, parameters }, { signal });
    }
    if (!accessToken || !config.apiBaseUrl) throw new Error('Connected device actions are unavailable.');
    const { response, payload } = await runBoundedRequest(async ({ signal: requestSignal, captureResponse }) => {
      const nextResponse = await fetchImpl(`${config.apiBaseUrl.replace(/\/$/, '')}/v1/device-actions`, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: toolCall.name, ...parameters }),
        signal: requestSignal
      });
      captureResponse(nextResponse);
      const nextPayload = nextResponse.status === 204
        ? (await cancelResponseBody(nextResponse), null)
        : await readBoundedJSONResponse(nextResponse, { signal: requestSignal });
      return { response: nextResponse, payload: nextPayload };
    }, { timeoutMs, signal });
    if (!response.ok) throw new Error(`Device action service returned ${response.status}.`);
    return JSON.stringify(payload);
  }
  if (toolCall?.name !== SAFETY_TIPS_TOOL_NAME) throw new Error(`Unsupported Hume tool: ${toolCall?.name || 'unknown'}`);
  const { scenario } = parseSafetyToolParameters(toolCall.parameters);
  try {
    if (!config.humeCustomizationURL) return JSON.stringify(localSafetyToolResult(scenario));
    const baseURL = config.humeCustomizationURL.replace(/\/$/, '');
    const { response, payload: result } = await runBoundedRequest(async ({ signal: requestSignal, captureResponse }) => {
      const nextResponse = await fetchImpl(`${baseURL}/v1/safety/tips`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ scenario }),
        signal: requestSignal
      });
      captureResponse(nextResponse);
      const payload = nextResponse.status === 204
        ? (await cancelResponseBody(nextResponse), null)
        : await readBoundedJSONResponse(nextResponse, { signal: requestSignal });
      return { response: nextResponse, payload };
    }, { timeoutMs, signal });
    if (!response.ok) throw new Error(`Safety tips service returned ${response.status}.`);
    if (!Array.isArray(result?.tips) || !result.tips.length) throw new Error('Safety tips service returned an invalid response.');
    return JSON.stringify({ ...result, scenario, source: 'veryloving_backend' });
  } catch (error) {
    if (signal?.aborted) throw error;
    return JSON.stringify(localSafetyToolResult(scenario));
  }
}

export { AI_ANGEL_TOOL_NAME, SAFETY_TIPS_TOOL_NAME };
