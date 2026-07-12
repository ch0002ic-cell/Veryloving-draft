export class OperationTimeoutError extends Error {
  constructor(message = 'The operation timed out.') {
    super(message);
    this.name = 'OperationTimeoutError';
    this.code = 'TIMEOUT';
  }
}

export async function withTimeout(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new OperationTimeoutError(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
