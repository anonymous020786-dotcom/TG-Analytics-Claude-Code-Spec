import type { FailureClass } from '@tga/types';

export type TelegramBackend = 'bot_api' | 'mtproto';

/** Classified Telegram failure (TelegramErrorClassifier output). Never contains credentials. */
export class TelegramError extends Error {
  constructor(
    readonly failureClass: FailureClass,
    /** Stable machine code, e.g. "chat_not_found", "FLOOD_WAIT", "not_public". */
    readonly code: string,
    message: string,
    readonly options: { backend?: TelegramBackend; retryAfterMs?: number; status?: number } = {},
  ) {
    super(message);
    this.name = 'TelegramError';
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }
}

/** Bot API error response (`ok: false`). */
export interface BotApiErrorBody {
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export function classifyBotApiError(httpStatus: number, body: BotApiErrorBody | undefined): TelegramError {
  const code = body?.error_code ?? httpStatus;
  const description = sanitize(body?.description ?? `HTTP ${httpStatus}`);
  const opts = { backend: 'bot_api' as const, status: code };

  if (code === 429) {
    const seconds = body?.parameters?.retry_after;
    return new TelegramError('rate_limited', 'too_many_requests', description, {
      ...opts,
      retryAfterMs: typeof seconds === 'number' && seconds > 0 ? seconds * 1_000 : 1_000,
    });
  }
  if (code === 400) {
    const notFound = /chat not found|user not found|username not found/i.test(description);
    return new TelegramError('invalid_input', notFound ? 'chat_not_found' : 'bad_request', description, opts);
  }
  // 401: invalid token. 404: invalid token or method. 403: bot blocked/kicked or no rights.
  if (code === 401 || code === 404) return new TelegramError('authorization', 'unauthorized', description, opts);
  if (code === 403) return new TelegramError('authorization', 'forbidden', description, opts);
  if (code >= 500) return new TelegramError('transient', 'server_error', description, opts);
  return new TelegramError('unknown', 'unexpected', description, opts);
}

/** MTProto RPC error, e.g. { code: 420, message: "FLOOD_WAIT_30" } (core.telegram.org/api/errors). */
export interface MtprotoRpcError {
  code: number;
  message: string;
}

const WAIT_PATTERN = /^(FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT)_(\d+)$/;
const NOT_PUBLIC = new Set(['CHANNEL_PRIVATE', 'CHANNEL_PUBLIC_GROUP_NA', 'CHAT_FORBIDDEN']);

export function classifyMtprotoError(error: MtprotoRpcError): TelegramError {
  const opts = { backend: 'mtproto' as const, status: error.code };
  const name = sanitize(error.message);
  const wait = WAIT_PATTERN.exec(name);
  if (wait?.[1] && wait[2]) {
    return new TelegramError('rate_limited', wait[1], name, { ...opts, retryAfterMs: Number(wait[2]) * 1_000 });
  }
  if (NOT_PUBLIC.has(name)) return new TelegramError('permanent', 'not_public', name, opts);
  if (error.code === 401) return new TelegramError('authorization', name, name, opts);
  if (error.code === 403) return new TelegramError('permanent', name, name, opts);
  if (error.code === 400 || error.code === 406) return new TelegramError('invalid_input', name, name, opts);
  if (error.code === 420) return new TelegramError('rate_limited', name, name, { ...opts, retryAfterMs: 1_000 });
  if (error.code >= 500) return new TelegramError('transient', name, name, opts);
  return new TelegramError('unknown', name, name, opts);
}

/** Network-level failures: timeouts and resets are transient; DNS/refused mean the dependency is down. */
export function classifyNetworkError(error: unknown, backend: TelegramBackend): TelegramError {
  const name = error instanceof Error ? error.name : '';
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? '';
  const opts = { backend };
  if (name === 'TimeoutError' || name === 'AbortError') return new TelegramError('transient', 'timeout', 'request timed out', opts);
  if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ETIMEDOUT'].includes(code)) {
    return new TelegramError('transient', code, 'connection interrupted', opts);
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) {
    return new TelegramError('dependency_down', code, 'Telegram unreachable', opts);
  }
  return new TelegramError('unknown', 'network', 'network error', opts);
}

/** Strips anything that looks like a bot token or bot URL from provider text (THREAT-MODEL T12). */
export function sanitize(text: string): string {
  return text
    .replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot[REDACTED]')
    .replace(/\d{5,}:[A-Za-z0-9_-]{30,}/g, '[REDACTED]')
    .slice(0, 500);
}
