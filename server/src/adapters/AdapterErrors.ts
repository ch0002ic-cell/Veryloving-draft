export type RobotAdapterErrorCode =
  | 'ADAPTER_ACTION_EXPIRED'
  | 'ADAPTER_AUTH_FAILED'
  | 'ADAPTER_CONFIGURATION_INVALID'
  | 'ADAPTER_INITIALIZATION_CONFLICT'
  | 'ADAPTER_NETWORK_FAILED'
  | 'ADAPTER_NOT_INITIALIZED'
  | 'ADAPTER_REQUEST_INVALID'
  | 'ADAPTER_REQUEST_REJECTED'
  | 'ADAPTER_RESPONSE_INVALID'
  | 'ADAPTER_RESPONSE_TOO_LARGE'
  | 'ADAPTER_TIMEOUT'
  | 'ADAPTER_UNAVAILABLE';

export class RobotAdapterError extends Error {
  readonly code: RobotAdapterErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly attempts?: number;

  constructor(
    code: RobotAdapterErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly statusCode?: number;
      readonly attempts?: number;
      readonly cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RobotAdapterError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.statusCode = options.statusCode;
    this.attempts = options.attempts;
  }
}
