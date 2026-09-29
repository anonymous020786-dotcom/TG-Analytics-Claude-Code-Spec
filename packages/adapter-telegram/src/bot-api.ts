import { type BotApiErrorBody, classifyBotApiError, classifyNetworkError, TelegramError } from './errors';

export interface BotApiClientOptions {
  /** Bot token (secret). Used only to build the request URL; never logged or placed in errors. */
  token: string;
  baseUrl?: string;
  /** Per-request timeout (CLAUDE.md: external calls need timeouts). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_BOT_API_TIMEOUT_MS = 10_000;

/** Minimal Bot API transport: POST JSON, bounded timeout, classified errors. */
export class BotApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BotApiClientOptions) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(options.token)) {
      throw new TelegramError('authorization', 'invalid_token_format', 'Bot token has an invalid format');
    }
    this.baseUrl = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_BOT_API_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<T>(method: string, params: Record<string, string | number>): Promise<T> {
    if (!/^[a-zA-Z]{3,64}$/.test(method)) throw new TelegramError('invalid_input', 'bad_method', 'Invalid Bot API method');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/bot${this.options.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      throw classifyNetworkError(error, 'bot_api');
    }
    let body: ({ ok?: boolean; result?: T } & BotApiErrorBody) | undefined;
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = undefined;
    }
    if (response.ok && body?.ok === true && body.result !== undefined) return body.result;
    throw classifyBotApiError(response.status, body);
  }
}
