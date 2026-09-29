import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Field names that must never reach logs (OBSERVABILITY.md, THREAT-MODEL T12). */
export const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'api_key',
  'apiHash',
  'api_hash',
  'botToken',
  'session',
  'sessionString',
  'cookie',
  'authorization',
] as const;

export const REDACT_PATHS: string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

export const REDACTED = '[REDACTED]';

export interface CreateLoggerOptions {
  /** Component name, e.g. "api" or "worker-metrics". */
  name: string;
  level?: LoggerOptions['level'];
  /** Override the output stream (tests). Defaults to stdout. */
  destination?: DestinationStream;
}

/** Structured JSON logger with secret redaction. */
export function createLogger({ name, level = 'info', destination }: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    name,
    level,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: { level: (label) => ({ level: label }) },
  };
  return destination ? pino(options, destination) : pino(options);
}
