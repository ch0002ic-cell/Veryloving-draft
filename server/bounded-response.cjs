'use strict';

async function cancelResponseBody(response) {
  try { await response?.body?.cancel?.(); } catch {}
}

function responseError(context, code, message) {
  return Object.assign(new Error(`${context} ${message}`), { code });
}

async function readBoundedResponseText(response, {
  context = 'Upstream',
  maxBytes,
  signal
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('Response size limit is invalid');
  }
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelResponseBody(response);
    throw responseError(context, 'UPSTREAM_RESPONSE_TOO_LARGE', 'response is too large');
  }
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    void aborted.catch(() => {});
    let cancellation;
    let cancelled = false;
    const cancelReader = () => {
      if (cancelled) return cancellation;
      cancelled = true;
      try { cancellation = Promise.resolve(reader.cancel?.()).catch(() => {}); } catch {
        cancellation = Promise.resolve();
      }
      return cancellation;
    };
    const cancelOnAbort = () => {
      cancelReader();
      rejectAbort(signal?.reason instanceof Error
        ? signal.reason
        : Object.assign(new Error(`${context} response was aborted`), { name: 'AbortError' }));
    };
    if (signal?.aborted) cancelOnAbort();
    else signal?.addEventListener('abort', cancelOnAbort, { once: true });
    const chunks = [];
    let received = 0;
    try {
      if (signal?.aborted) await aborted;
      while (true) {
        const read = Promise.resolve().then(() => reader.read());
        void read.catch(() => {});
        const { done, value } = signal
          ? await Promise.race([read, aborted])
          : await read;
        if (done) break;
        const chunk = Buffer.from(value || new Uint8Array());
        received += chunk.length;
        if (received > maxBytes) {
          await cancelReader();
          throw responseError(context, 'UPSTREAM_RESPONSE_TOO_LARGE', 'response is too large');
        }
        chunks.push(chunk);
      }
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
      const pendingCancellation = cancelReader();
      let released = false;
      const release = () => {
        if (released) return;
        try { reader.releaseLock?.(); released = true; } catch {}
      };
      release();
      if (!released && pendingCancellation) void pendingCancellation.then(release);
    }
    return Buffer.concat(chunks, received).toString('utf8');
  }
  let text;
  if (typeof response?.text === 'function') text = await response.text();
  else if (typeof response?.json === 'function') text = JSON.stringify(await response.json());
  else text = '';
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) {
    await cancelResponseBody(response);
    throw responseError(context, 'UPSTREAM_RESPONSE_TOO_LARGE', 'response is too large');
  }
  return text;
}

async function readBoundedJSONResponse(response, options) {
  const text = await readBoundedResponseText(response, options);
  if (!text) throw responseError(options?.context || 'Upstream', 'UPSTREAM_RESPONSE_INVALID', 'response is invalid');
  try {
    return JSON.parse(text);
  } catch {
    throw responseError(options?.context || 'Upstream', 'UPSTREAM_RESPONSE_INVALID', 'response is invalid');
  }
}

module.exports = { cancelResponseBody, readBoundedJSONResponse, readBoundedResponseText };
