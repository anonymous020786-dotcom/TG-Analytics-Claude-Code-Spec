import type { TelegramBackend } from './errors';

/**
 * Operation → backend map, mirroring docs/telegram/CAPABILITY-MATRIX.md. Only operations
 * marked verified may run; anything else fails closed until verified live (PHASE-05A gate).
 */
export const CAPABILITIES = {
  resolvePublicEntity: { backend: 'bot_api', verified: true },
  memberCount: { backend: 'bot_api', verified: true },
  entityFlags: { backend: 'mtproto', verified: false },
  recentPosts: { backend: 'mtproto', verified: false },
} as const satisfies Record<string, { backend: TelegramBackend; verified: boolean }>;

export type Operation = keyof typeof CAPABILITIES;
