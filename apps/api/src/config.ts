import { defineConfig, loadConfig, type Config } from '@tga/config';
import { z } from 'zod';

/** Optional variables: an empty value (as in .env.example) means "not configured". */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * API configuration. Every variable is documented in `.env.example` and
 * docs/operations/CONFIGURATION.md; a test keeps them in sync.
 */
export const apiConfigSpec = defineConfig({
  shape: {
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().min(1),
    /** Expected refresh intervals, used to judge freshness (same values as the scheduler). */
    METRICS_REFRESH_MINUTES: z.coerce.number().int().min(5).max(10_080).default(360),
    METADATA_REFRESH_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1_440),
    /** Indexation rule thresholds (PHASE-14, approved as D-018). */
    SEO_MIN_MEMBERS: z.coerce.number().int().min(0).max(1_000_000_000).default(1_000),
    SEO_MIN_HISTORY_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    /**
     * Sign in with Telegram (PHASE-16, D-021). All three must be set to enable the auth routes.
     * The login bot needs the site domain set in BotFather (/setdomain).
     */
    TELEGRAM_LOGIN_BOT_TOKEN: optional(z.string().regex(/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/)),
    TELEGRAM_LOGIN_BOT_USERNAME: optional(z.string().regex(/^[A-Za-z0-9_]{2,29}bot$/i)),
    CSRF_SECRET: optional(z.string().min(32).max(256)),
    /** Allowed Origin for state-changing requests; same value as the web's PUBLIC_SITE_URL. */
    PUBLIC_SITE_URL: z.url().default('http://127.0.0.1:3000'),
    /** Session lifetimes (provisional, OD-005). */
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /** Secure + __Host- cookies. Only turn off for plain-HTTP non-localhost testing. */
    COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  },
  secrets: ['DATABASE_URL', 'TELEGRAM_LOGIN_BOT_TOKEN', 'CSRF_SECRET'],
});

export type ApiConfig = Config<typeof apiConfigSpec.shape>;

export function loadApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  return loadConfig(apiConfigSpec, env);
}
