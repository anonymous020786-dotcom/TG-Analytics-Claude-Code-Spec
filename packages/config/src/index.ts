import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Deployment environments (PHASE-03). Distinct from NODE_ENV, which only selects build behaviour. */
export const APP_ENVS = ['local', 'development', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const appEnvSchema = z.enum(APP_ENVS).default('local');

/** Values that indicate an unconfigured secret; rejected outside `local`. */
const PLACEHOLDER = /^(?:change[-_]?me|placeholder|example|secret|password|todo|x+)(?:[-_].*)?$/i;

export interface ConfigSpec<S extends z.ZodRawShape> {
  shape: S;
  /** Keys whose values are secret: never logged or echoed, may be read from `<KEY>_FILE`. */
  secrets?: readonly (keyof S & string)[];
}

export type Config<S extends z.ZodRawShape> = Readonly<z.infer<z.ZodObject<S & { APP_ENV: typeof appEnvSchema }>>>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function defineConfig<S extends z.ZodRawShape>(spec: ConfigSpec<S>): ConfigSpec<S> {
  return spec;
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

/**
 * Validates configuration from the environment. Reads only declared keys, supports
 * `<SECRET>_FILE`, never includes secret values in errors, and returns a frozen object.
 * Throws ConfigError listing every problem.
 */
export function loadConfig<S extends z.ZodRawShape>(
  spec: ConfigSpec<S>,
  env: Env = process.env,
  readFile: ReadFile = defaultReadFile,
): Config<S> {
  const secrets = new Set<string>(spec.secrets ?? []);
  const issues: string[] = [];
  const input: Record<string, string | undefined> = { APP_ENV: env.APP_ENV };

  for (const key of Object.keys(spec.shape)) {
    const fileKey = `${key}_FILE`;
    if (!secrets.has(key) || env[fileKey] === undefined) {
      input[key] = env[key];
      continue;
    }
    if (env[key] !== undefined) {
      issues.push(`${key}: set only one of ${key} or ${fileKey}`);
      continue;
    }
    try {
      input[key] = readFile(env[fileKey]).replace(/\r?\n$/, '');
    } catch {
      issues.push(`${fileKey}: cannot read secret file`);
    }
  }

  const schema = z.object({ ...spec.shape, APP_ENV: appEnvSchema });
  const result = schema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '(root)');
      if (issues.some((i) => i.startsWith(`${key}:`) || i.startsWith(`${key}_FILE:`))) continue;
      const message = secrets.has(key) ? (input[key] === undefined ? 'required' : 'invalid value') : issue.message;
      issues.push(`${key}: ${message}`);
    }
  }
  if (issues.length) throw new ConfigError(issues);

  const data = (result as { data: Record<string, unknown> }).data;
  if (data.APP_ENV !== 'local') {
    for (const key of secrets) {
      if (typeof data[key] === 'string' && PLACEHOLDER.test(data[key])) {
        issues.push(`${key}: placeholder secret not allowed when APP_ENV=${String(data.APP_ENV)}`);
      }
    }
    if (issues.length) throw new ConfigError(issues);
  }
  return Object.freeze(data) as Config<S>;
}

/** Copy of a loaded config with secret values masked, for startup logging. */
export function redactConfig<S extends z.ZodRawShape>(spec: ConfigSpec<S>, config: Config<S>): Record<string, unknown> {
  const secrets = new Set<string>(spec.secrets ?? []);
  return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, secrets.has(k) ? '[REDACTED]' : v]));
}
export { workerConfigShape, workerSecrets } from './worker';
