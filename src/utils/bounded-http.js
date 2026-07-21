const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

function byteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function httpError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function cancelResponseBody(response) {
  try { await response?.body?.cancel?.(); } catch {}
}

export async function readBoundedByteStream(reader, {
  signal,
  maxBytes,
  invalidError = () => httpError('HTTP_RESPONSE_INVALID', 'The service response was invalid.'),
  tooLargeError = () => httpError('HTTP_RESPONSE_TOO_LARGE', 'The service response was too large.')
} = {}) {
  if (!reader || typeof reader.read !== 'function') throw invalidError();
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
      : Object.assign(new Error('The response was aborted.'), { name: 'AbortError' }));
  };
  if (signal?.aborted) cancelOnAbort();
  else signal?.addEventListener?.('abort', cancelOnAbort, { once: true });
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
      if (!(value instanceof Uint8Array)) throw invalidError();
      received += value.byteLength;
      if (received > maxBytes) {
        cancelReader();
        throw tooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener?.('abort', cancelOnAbort);
    const pendingCancellation = cancelReader();
    let released = false;
    const release = () => {
      if (released) return;
      try {
        reader.releaseLock?.();
        released = true;
      } catch {}
    };
    release();
    if (!released && pendingCancellation) void pendingCancellation.then(release);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedJSONResponse(response, {
  signal,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES
} = {}) {
  const rawLength = response?.headers?.get?.('content-length');
  if (rawLength !== undefined && rawLength !== null
    && (!/^\d{1,12}$/.test(rawLength) || Number(rawLength) > maxBytes)) {
    await cancelResponseBody(response);
    throw httpError('HTTP_RESPONSE_TOO_LARGE', 'The service response was too large.');
  }

  let text;
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const bytes = await readBoundedByteStream(reader, { signal, maxBytes });
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      throw httpError('HTTP_RESPONSE_INVALID', 'The service response was invalid.');
    }
  } else if (rawLength === undefined || rawLength === null) {
    // React Native runtimes without ReadableStream support cannot enforce a
    // chunked body limit before text() allocates it. Require the trusted
    // server's Content-Length so a hostile response cannot exhaust memory.
    await cancelResponseBody(response);
    throw httpError('HTTP_RESPONSE_INVALID', 'The service response was invalid.');
  } else if (typeof response?.text === 'function') {
    text = await response.text();
  } else {
    throw httpError('HTTP_RESPONSE_INVALID', 'The service response was invalid.');
  }

  if (typeof text !== 'string') throw httpError('HTTP_RESPONSE_INVALID', 'The service response was invalid.');
  if (byteLength(text) > maxBytes) throw httpError('HTTP_RESPONSE_TOO_LARGE', 'The service response was too large.');
  if (!text) return null;
  try { return JSON.parse(text); } catch {
    throw httpError('HTTP_RESPONSE_INVALID', 'The service response was invalid.');
  }
}

export async function runBoundedRequest(operation, {
  timeoutMs,
  signal: externalSignal
} = {}) {
  if (typeof operation !== 'function') throw new TypeError('A request operation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new RangeError('The request timeout is invalid.');
  }
  if (externalSignal?.aborted) throw httpError('HTTP_REQUEST_ABORTED', 'The request was cancelled.');

  const controller = new AbortController();
  let response;
  let rejectDeadline;
  let deadlineSettled = false;
  const abort = (code, message) => {
    if (deadlineSettled) return;
    deadlineSettled = true;
    controller.abort();
    void cancelResponseBody(response);
    rejectDeadline(httpError(code, message));
  };
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timeout = setTimeout(
    () => abort('HTTP_REQUEST_TIMEOUT', 'The request timed out.'),
    timeoutMs
  );
  const externalAbort = () => abort('HTTP_REQUEST_ABORTED', 'The request was cancelled.');
  externalSignal?.addEventListener?.('abort', externalAbort, { once: true });
  const request = Promise.resolve().then(() => operation({
    signal: controller.signal,
    captureResponse(nextResponse) {
      response = nextResponse;
      if (controller.signal.aborted) void cancelResponseBody(response);
    }
  }));
  void request.catch(() => {});
  try {
    return await Promise.race([request, deadline]);
  } finally {
    deadlineSettled = true;
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.('abort', externalAbort);
  }
}
