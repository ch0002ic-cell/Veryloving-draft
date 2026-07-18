import { createHash } from 'node:crypto';
import type { RobotVendor } from './RobotAdapter';

export type AdapterLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AdapterLogSink {
  debug?(entry: Readonly<Record<string, unknown>>): void;
  info?(entry: Readonly<Record<string, unknown>>): void;
  warn?(entry: Readonly<Record<string, unknown>>): void;
  error?(entry: Readonly<Record<string, unknown>>): void;
  log?(entry: Readonly<Record<string, unknown>>): void;
}

export interface AdapterLogFields {
  readonly adapterId: string;
  readonly vendor: RobotVendor;
  readonly operation: string;
  readonly attempt?: number;
  readonly latencyMs?: number;
  readonly statusCode?: number;
  readonly outcome?: 'success' | 'retry' | 'failure';
  readonly errorCode?: string;
}

export interface StructuredAdapterLogger {
  write(level: AdapterLogLevel, event: string, fields: AdapterLogFields): void;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_REFERENCE = /^adapter_[a-f0-9]{12}$/;
const SAFE_OPERATION = /^[a-z][a-z0-9_.-]{0,95}$/;
const SAFE_EVENT = /^robot_adapter\.[a-z0-9_.-]{1,80}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,80}$/;

export function createSafeAdapterReference(adapterId: string): string {
  return `adapter_${createHash('sha256').update(adapterId).digest('hex').slice(0, 12)}`;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : undefined;
}

/**
 * Creates a log event from an allowlist. Unknown fields, request/response
 * bodies, URLs, credentials, IP addresses, user identifiers, medication names,
 * hardware serials and raw exception messages can never enter the sink.
 */
export function createSafeAdapterLogEntry(
  event: string,
  fields: AdapterLogFields
): Readonly<Record<string, unknown>> {
  const adapterId = SAFE_REFERENCE.test(fields.adapterId)
    ? fields.adapterId
    : SAFE_IDENTIFIER.test(fields.adapterId)
      ? createSafeAdapterReference(fields.adapterId)
    : '[REDACTED]';
  const operation = SAFE_OPERATION.test(fields.operation) ? fields.operation : 'unknown';
  const safeEvent = SAFE_EVENT.test(event) ? event : 'robot_adapter.unknown';
  const attempt = safeInteger(fields.attempt, 1, 100);
  const latencyMs = safeInteger(Math.round(Number(fields.latencyMs)), 0, 86_400_000);
  const statusCode = safeInteger(fields.statusCode, 100, 599);
  const errorCode = typeof fields.errorCode === 'string' && SAFE_ERROR_CODE.test(fields.errorCode)
    ? fields.errorCode
    : undefined;

  return Object.freeze({
    event: safeEvent,
    adapterId,
    vendor: fields.vendor === 'jiangzhi' ? 'jiangzhi' : 'yongyida',
    operation,
    ...(attempt === undefined ? {} : { attempt }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
    ...(errorCode === undefined ? {} : { errorCode })
  });
}

export function createStructuredAdapterLogger(
  sink: AdapterLogSink = console
): StructuredAdapterLogger {
  return Object.freeze({
    write(level: AdapterLogLevel, event: string, fields: AdapterLogFields): void {
      const writer = typeof sink[level] === 'function' ? sink[level] : sink.log;
      try {
        writer?.call(sink, createSafeAdapterLogEntry(event, fields));
      } catch {
        // Observability is best-effort and cannot fail a safety command.
      }
    }
  });
}
