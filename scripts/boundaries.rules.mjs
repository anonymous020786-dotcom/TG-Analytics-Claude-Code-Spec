// Import rules from docs/architecture/SERVICE-BOUNDARIES.md §4. Update both together.

export const SCOPE = '@tga/';

/** Shared library packages (packages/<name>) → @tga packages they may import. */
export const LIBRARY_RULES = {
  types: [],
  validation: ['types'],
  logging: ['types'],
  analytics: ['types'],
  security: ['types', 'logging'],
  auth: ['types', 'validation', 'security', 'database'],
  database: ['types', 'logging'],
  queues: ['types', 'validation', 'logging'],
  ui: ['types'],
  config: [],
};

/** Presentation app: only these libraries (never database/queues/adapters). */
export const WEB_ALLOWED = ['ui', 'types', 'validation'];

/** Libraries that must stay free of I/O (pure). */
export const PURE_LIBRARIES = ['types', 'validation', 'analytics', 'ui'];

export const IO_MODULES = [
  'fs', 'net', 'http', 'https', 'http2', 'child_process', 'dgram', 'tls', 'dns', 'worker_threads',
  'pg', 'postgres', 'ioredis', 'redis', 'bullmq', 'undici', 'axios', 'node-fetch', '@clickhouse/client',
];

/** Provider SDKs: only adapter packages (packages/adapter-*) may import these. */
export const PROVIDER_SDKS = [
  'telegram', 'grammy', 'telegraf', 'node-telegram-bot-api', 'tdl', 'tdl-tdlib-addon', 'airgram',
  'stripe', 'razorpay', 'paddle-sdk', '@paddle/paddle-node-sdk',
  '@sendgrid/mail', 'nodemailer', 'resend', 'postmark',
  '@aws-sdk/*', '@google-cloud/*', 'minio',
  'meilisearch', 'typesense', '@elastic/elasticsearch', '@opensearch-project/opensearch',
];
