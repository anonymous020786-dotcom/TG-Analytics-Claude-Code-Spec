import { classifyMtprotoError, type MtprotoRpcError, TelegramError } from './errors';
import { mapMtprotoChannel, mapMtprotoMessage, type TelegramEntity, type TelegramPost } from './mapper';

/**
 * MTProto transport contract. The concrete client library (and its session handling) is
 * chosen when OD-003 provides a dedicated account; until then only this interface and
 * fakes exist (ADR-005). Implementations throw `{ code, message }` RPC errors.
 */
export interface MtprotoTransport {
  invoke(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Upper bound for one history page (provisional; the method page states no maximum). */
export const MAX_HISTORY_PAGE = 100;

function isRpcError(e: unknown): e is MtprotoRpcError {
  return typeof e === 'object' && e !== null && typeof (e as MtprotoRpcError).code === 'number' && typeof (e as MtprotoRpcError).message === 'string';
}

export class MtprotoBackend {
  constructor(private readonly transport: MtprotoTransport) {}

  private async invoke(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      return (await this.transport.invoke(method, params)) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      if (isRpcError(error)) throw classifyMtprotoError(error);
      throw new TelegramError('unknown', 'mtproto_transport', 'MTProto transport failure', { backend: 'mtproto' });
    }
  }

  /** contacts.resolveUsername → channel constructor (incl. verified/scam/fake flags). */
  async resolveChannel(username: string): Promise<TelegramEntity> {
    const res = await this.invoke('contacts.resolveUsername', { username });
    const chats = Array.isArray(res.chats) ? (res.chats as Record<string, unknown>[]) : [];
    const channel = chats.find((c) => c._ === 'channel');
    if (!channel) throw new TelegramError('permanent', 'not_public', 'Username does not resolve to a public channel or group', { backend: 'mtproto' });
    return mapMtprotoChannel(channel);
  }

  /** messages.getHistory (user accounts only). Newest first, bounded page. */
  async recentPosts(username: string, limit: number): Promise<TelegramPost[]> {
    const pageSize = Math.min(Math.max(1, Math.trunc(limit)), MAX_HISTORY_PAGE);
    const res = await this.invoke('messages.getHistory', { peer: username, limit: pageSize });
    const messages = Array.isArray(res.messages) ? (res.messages as Record<string, unknown>[]) : [];
    return messages.filter((m) => m._ === 'message').map(mapMtprotoMessage);
  }
}
