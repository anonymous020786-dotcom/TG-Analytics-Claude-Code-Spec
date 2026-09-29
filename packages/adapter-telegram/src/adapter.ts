import type { SnapshotSource } from '@tga/types';
import type { BotApiClient } from './bot-api';
import { CAPABILITIES, type Operation } from './capabilities';
import { TelegramError } from './errors';
import { mapBotApiChat, type TelegramEntity, type TelegramPost } from './mapper';
import type { MtprotoBackend } from './mtproto';
import type { RateLimiter } from './rate-limiter';
import { DEFAULT_RETRY, type RetryOptions, withRetry } from './retry';

/** Observation wrapper: every value carries when and where it was observed (INTEGRATION.md). */
export interface Observed<T> {
  value: T;
  observedAt: Date;
  source: SnapshotSource;
}

export interface TelegramClientAdapterOptions {
  botApi: BotApiClient;
  /** Absent until OD-003 provides a dedicated MTProto account. */
  mtproto?: MtprotoBackend;
  limiter: RateLimiter;
  /** Non-secret identifier of the credential in use, for rate-limit keys (e.g. "bot-1"). */
  credentialId: string;
  retry?: RetryOptions;
  /** Operations verified live after PHASE-05A (e.g. once OD-003 is resolved). */
  additionallyVerified?: readonly Operation[];
  now?: () => Date;
}

const USERNAME = /^[a-z][a-z0-9_]{3,31}$/;

/**
 * TelegramChannelResolver input rule: a bare or "@"-prefixed public username only.
 * URL/link normalization belongs to discovery (PHASE-07). Rejects before any network call.
 */
export function validatePublicUsername(input: string): string {
  const u = input.trim().replace(/^@/, '').toLowerCase();
  if (!USERNAME.test(u)) throw new TelegramError('invalid_input', 'invalid_username', 'Not a valid public Telegram username');
  return u;
}

/**
 * TelegramClientAdapter: the only entry point to Telegram (INTEGRATION.md). Controllers and
 * domain code never call provider APIs directly (FR-TG-01).
 */
export class TelegramClientAdapter {
  private readonly now: () => Date;
  private readonly verified: Set<Operation>;

  constructor(private readonly options: TelegramClientAdapterOptions) {
    this.now = options.now ?? (() => new Date());
    this.verified = new Set([
      ...(Object.keys(CAPABILITIES) as Operation[]).filter((op) => CAPABILITIES[op].verified),
      ...(options.additionallyVerified ?? []),
    ]);
  }

  /** getChat by public username: metadata for a public channel or group, without joining. */
  async resolvePublicEntity(username: string): Promise<Observed<TelegramEntity>> {
    const name = validatePublicUsername(username);
    return this.run('resolvePublicEntity', async () => mapBotApiChat(await this.options.botApi.call('getChat', { chat_id: `@${name}` })));
  }

  /** Current subscriber/member count. */
  async getMemberCount(username: string): Promise<Observed<bigint>> {
    const name = validatePublicUsername(username);
    return this.run('memberCount', async () => {
      const count = await this.options.botApi.call<number>('getChatMemberCount', { chat_id: `@${name}` });
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new TelegramError('unknown', 'malformed_response', 'Unexpected member count');
      }
      return BigInt(count);
    });
  }

  /** Verified/scam/fake flags (MTProto only). */
  async getEntityFlags(username: string): Promise<Observed<TelegramEntity>> {
    const name = validatePublicUsername(username);
    return this.run('entityFlags', () => this.mtproto().resolveChannel(name));
  }

  /** Recent channel posts with views/forwards/replies/reactions (MTProto, user accounts only). */
  async getRecentPosts(username: string, limit: number): Promise<Observed<TelegramPost[]>> {
    const name = validatePublicUsername(username);
    return this.run('recentPosts', () => this.mtproto().recentPosts(name, limit));
  }

  private mtproto(): MtprotoBackend {
    if (!this.options.mtproto) {
      throw new TelegramError('permanent', 'mtproto_not_configured', 'MTProto backend is not configured (OD-003)', { backend: 'mtproto' });
    }
    return this.options.mtproto;
  }

  private async run<T>(operation: Operation, fn: () => Promise<T>): Promise<Observed<T>> {
    const { backend } = CAPABILITIES[operation];
    if (!this.verified.has(operation)) {
      throw new TelegramError('permanent', 'capability_unverified', `Operation "${operation}" is not verified (CAPABILITY-MATRIX)`, { backend });
    }
    const key = `${backend}:${this.options.credentialId}`;
    const permit = this.options.limiter.tryAcquire(key);
    if (!permit.ok) {
      throw new TelegramError('rate_limited', 'local_rate_limit', 'Local rate limit reached', { backend, retryAfterMs: permit.retryAfterMs });
    }
    try {
      const value = await withRetry(fn, this.options.retry ?? DEFAULT_RETRY);
      return { value, observedAt: this.now(), source: backend };
    } catch (error) {
      if (error instanceof TelegramError && error.failureClass === 'rate_limited' && error.retryAfterMs !== undefined) {
        this.options.limiter.penalize(key, error.retryAfterMs);
      }
      throw error;
    }
  }
}
