import { describe, expect, it } from 'vitest';
import { TelegramError } from './errors';
import { mapBotApiChat, mapMtprotoChannel, mapMtprotoMessage, toMarkedChannelId } from './mapper';

/** Shape recorded from the PHASE-05A live probe of the public @telegram channel. */
const telegramChannel = {
  id: -1001005640892,
  type: 'channel',
  title: 'Telegram News',
  username: 'telegram',
  active_usernames: ['telegram'],
  description: 'The official Telegram on Telegram.',
  has_visible_history: true,
  accent_color_id: 1,
  max_reaction_count: 11,
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof TelegramError ? `${e.failureClass}:${e.code}` : 'other';
  }
  return 'none';
};

describe('mapBotApiChat', () => {
  it('maps a public channel', () => {
    expect(mapBotApiChat(telegramChannel)).toEqual({
      telegramId: -1001005640892n,
      type: 'channel',
      username: 'telegram',
      activeUsernames: ['telegram'],
      title: 'Telegram News',
      description: 'The official Telegram on Telegram.',
      hasVisibleHistory: true,
    });
  });

  it('maps supergroups to "group" and lowercases usernames', () => {
    const e = mapBotApiChat({ id: -1001, type: 'supergroup', title: 'Bot Talk', username: 'BotTalk', linked_chat_id: -1002 });
    expect(e.type).toBe('group');
    expect(e.username).toBe('bottalk');
    expect(e.linkedChatId).toBe(-1002n);
  });

  it.each([
    ['private chats', { id: 1, type: 'private', first_name: 'x', username: 'someone' }],
    ['entities without a public username', { id: -1001, type: 'channel', title: 'x' }],
  ])('rejects %s as not_public', (_label, chat) => {
    expect(code(() => mapBotApiChat(chat))).toBe('permanent:not_public');
  });

  it('rejects malformed payloads', () => {
    expect(code(() => mapBotApiChat({ ...telegramChannel, id: 'abc' }))).toBe('unknown:malformed_response');
    expect(code(() => mapBotApiChat({ ...telegramChannel, title: '' }))).toBe('unknown:malformed_response');
  });

  it('bounds untrusted text', () => {
    const e = mapBotApiChat({ ...telegramChannel, title: 'x'.repeat(10_000), description: 'y'.repeat(10_000) });
    expect(e.title.length).toBe(512);
    expect(e.description?.length).toBe(4_096);
  });
});

describe('MTProto mapping', () => {
  it('converts bare channel ids to the canonical Bot API id', () => {
    expect(toMarkedChannelId(1005640892n)).toBe(-1001005640892n);
  });

  it('maps a channel constructor, including verified/scam/fake flags', () => {
    const e = mapMtprotoChannel({ _: 'channel', id: 1005640892, broadcast: true, verified: true, username: 'telegram', title: 'Telegram News' });
    expect(e).toMatchObject({ telegramId: -1001005640892n, type: 'channel', username: 'telegram', isVerified: true, isScam: false, isFake: false });
  });

  it('uses the first active username when the main one is absent', () => {
    const e = mapMtprotoChannel({ id: 7, megagroup: true, usernames: [{ username: 'old', active: false }, { username: 'newname', active: true }], title: 'G' });
    expect(e.username).toBe('newname');
    expect(e.type).toBe('group');
  });

  it('maps message metrics, leaving unreported metrics undefined (never 0)', () => {
    const post = mapMtprotoMessage({
      _: 'message',
      id: 42,
      date: 1_767_225_600,
      views: 1500,
      forwards: 12,
      replies: { replies: 3 },
      reactions: { results: [{ count: 10 }, { count: 5 }] },
    });
    expect(post).toEqual({
      telegramMessageId: 42n,
      postedAt: new Date(1_767_225_600_000),
      editedAt: null,
      views: 1500n,
      forwards: 12n,
      replies: 3n,
      reactions: 15n,
    });
    const bare = mapMtprotoMessage({ id: 43, date: 1_767_225_600 });
    expect(bare.views).toBeUndefined();
    expect('reactions' in bare).toBe(false);
  });

  it('rejects negative counts from the provider', () => {
    expect(code(() => mapMtprotoMessage({ id: 1, date: 1, views: -5 }))).toBe('unknown:malformed_response');
  });
});
