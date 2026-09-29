import { describe, expect, it } from 'vitest';
import { normalizeTelegramReference } from './telegram-reference';

describe('normalizeTelegramReference', () => {
  it.each([
    ['telegram', 'telegram'],
    ['@Telegram', 'telegram'],
    ['  @durov  ', 'durov'],
    ['t.me/telegram', 'telegram'],
    ['https://t.me/telegram', 'telegram'],
    ['http://t.me/Telegram/', 'telegram'],
    ['https://www.t.me/telegram', 'telegram'],
    ['https://telegram.me/telegram', 'telegram'],
    ['https://telegram.dog/telegram', 'telegram'],
    ['https://t.me/s/telegram', 'telegram'],
    ['https://t.me/telegram/123', 'telegram'],
    ['https://t.me/telegram?start=x', 'telegram'],
    ['tg://resolve?domain=telegram', 'telegram'],
    ['tg://resolve?post=5&domain=BotTalk', 'bottalk'],
  ])('normalizes %j to %s', (input, username) => {
    expect(normalizeTelegramReference(input)).toEqual({ ok: true, username });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['x'.repeat(300), 'too_long'],
    ['https://t.me/+AbCdEf123', 'invite_link'],
    ['t.me/joinchat/AAAAAE', 'invite_link'],
    ['https://t.me/c/1005640892/12', 'private_link'],
    ['https://example.com/telegram', 'not_telegram_host'],
    ['https://t.me.evil.com/telegram', 'not_telegram_host'],
    ['https://user:pass@t.me/telegram', 'not_telegram_host'],
    ['https://t.me:8443/telegram', 'not_telegram_host'],
    ['http://169.254.169.254/latest/meta-data', 'not_telegram_host'],
    ['file:///etc/passwd', 'not_telegram_host'],
    ['javascript://t.me/%0aalert(1)', 'not_telegram_host'],
    ['https://t.me/addstickers/pack', 'unsupported_link'],
    ['https://t.me/telegram/abc', 'unsupported_link'],
    ['https://t.me/telegram/1/2', 'unsupported_link'],
    ['https://t.me/', 'unsupported_link'],
    ['tg://msg?text=hi', 'unsupported_link'],
    ['abc', 'invalid_username'],
    ['1telegram', 'invalid_username'],
    ['tele gram', 'invalid_username'],
    ["telegram'; DROP TABLE channels;--", 'invalid_username'],
    ['@', 'invalid_username'],
  ])('rejects %j as %s', (input, reason) => {
    expect(normalizeTelegramReference(input)).toEqual({ ok: false, reason });
  });
});
