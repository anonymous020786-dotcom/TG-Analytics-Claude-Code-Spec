import { TelegramError } from './errors';

/**
 * TelegramMapper: provider payloads → internal types. Provider data is untrusted and
 * validated here. Canonical telegramId = Bot API "marked" id (CAPABILITY-MATRIX §2):
 * channels/supergroups are -(10^12 + bare MTProto channel id).
 */

export type EntityType = 'channel' | 'group';

export interface TelegramEntity {
  telegramId: bigint;
  type: EntityType;
  /** Current public username, lowercase. Always present: only public entities are in scope (D-002). */
  username: string;
  activeUsernames: string[];
  title: string;
  description: string | null;
  hasVisibleHistory?: boolean;
  linkedChatId?: bigint;
  /** Only available via MTProto (CAPABILITY-MATRIX §1). */
  isVerified?: boolean;
  isScam?: boolean;
  isFake?: boolean;
}

export interface TelegramPost {
  telegramMessageId: bigint;
  postedAt: Date;
  editedAt: Date | null;
  /** Undefined means "not reported", never 0 (METRICS.md). */
  views?: bigint;
  forwards?: bigint;
  replies?: bigint;
  reactions?: bigint;
}

const CHANNEL_ID_OFFSET = 1_000_000_000_000n;
const USERNAME = /^[a-z][a-z0-9_]{3,31}$/;
const MAX_TITLE = 512;
const MAX_DESCRIPTION = 4_096;

export function toMarkedChannelId(bareId: bigint): bigint {
  if (bareId <= 0n) throw malformed('channel id must be positive');
  return -(CHANNEL_ID_OFFSET + bareId);
}

function malformed(detail: string): TelegramError {
  return new TelegramError('unknown', 'malformed_response', `Unexpected Telegram payload: ${detail}`);
}

function notPublic(): TelegramError {
  return new TelegramError('permanent', 'not_public', 'Entity is not a public channel or group');
}

function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw malformed(`${field} is not an integer`);
}

function cleanUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const u = value.toLowerCase();
  return USERNAME.test(u) ? u : null;
}

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw malformed('missing title');
  return value.slice(0, MAX_TITLE);
}

function cleanDescription(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_DESCRIPTION) : null;
}

/** Bot API ChatFullInfo (getChat). */
export function mapBotApiChat(chat: Record<string, unknown>): TelegramEntity {
  const type = chat.type === 'channel' ? 'channel' : chat.type === 'supergroup' || chat.type === 'group' ? 'group' : null;
  if (!type) throw notPublic();
  const username = cleanUsername(chat.username);
  if (!username) throw notPublic();
  const active = Array.isArray(chat.active_usernames) ? chat.active_usernames.map(cleanUsername).filter((u): u is string => !!u) : [];
  return {
    telegramId: toBigInt(chat.id, 'id'),
    type,
    username,
    activeUsernames: active.length ? active : [username],
    title: cleanTitle(chat.title),
    description: cleanDescription(chat.description),
    ...(typeof chat.has_visible_history === 'boolean' ? { hasVisibleHistory: chat.has_visible_history } : {}),
    ...(chat.linked_chat_id !== undefined ? { linkedChatId: toBigInt(chat.linked_chat_id, 'linked_chat_id') } : {}),
  };
}

/** MTProto `channel` constructor (core.telegram.org/constructor/channel). */
export function mapMtprotoChannel(ch: Record<string, unknown>): TelegramEntity {
  const type = ch.broadcast === true ? 'channel' : ch.megagroup === true || ch.gigagroup === true ? 'group' : null;
  if (!type) throw notPublic();
  const usernames = Array.isArray(ch.usernames)
    ? (ch.usernames as { username?: unknown; active?: unknown }[]).filter((u) => u.active !== false).map((u) => cleanUsername(u.username))
    : [];
  const active = usernames.filter((u): u is string => !!u);
  const username = cleanUsername(ch.username) ?? active[0] ?? null;
  if (!username) throw notPublic();
  return {
    telegramId: toMarkedChannelId(toBigInt(ch.id, 'id')),
    type,
    username,
    activeUsernames: active.length ? active : [username],
    title: cleanTitle(ch.title),
    description: null,
    isVerified: ch.verified === true,
    isScam: ch.scam === true,
    isFake: ch.fake === true,
  };
}

function optionalCount(value: unknown, field: string): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const n = toBigInt(value, field);
  if (n < 0n) throw malformed(`${field} is negative`);
  return n;
}

/** MTProto `message` constructor (core.telegram.org/constructor/message). */
export function mapMtprotoMessage(msg: Record<string, unknown>): TelegramPost {
  const date = toBigInt(msg.date, 'date');
  const edit = msg.edit_date === undefined ? null : toBigInt(msg.edit_date, 'edit_date');
  const replies = msg.replies as { replies?: unknown } | undefined;
  const reactions = msg.reactions as { results?: { count?: unknown }[] } | undefined;
  const reactionTotal = Array.isArray(reactions?.results)
    ? reactions.results.reduce((sum, r, i) => sum + (optionalCount(r.count, `reactions[${i}]`) ?? 0n), 0n)
    : undefined;
  const id = toBigInt(msg.id, 'id');
  if (id <= 0n) throw malformed('message id must be positive');
  const views = optionalCount(msg.views, 'views');
  const forwards = optionalCount(msg.forwards, 'forwards');
  const replyCount = optionalCount(replies?.replies, 'replies');
  return {
    telegramMessageId: id,
    postedAt: new Date(Number(date) * 1_000),
    editedAt: edit === null ? null : new Date(Number(edit) * 1_000),
    ...(views === undefined ? {} : { views }),
    ...(forwards === undefined ? {} : { forwards }),
    ...(replyCount === undefined ? {} : { replies: replyCount }),
    ...(reactionTotal === undefined ? {} : { reactions: reactionTotal }),
  };
}
