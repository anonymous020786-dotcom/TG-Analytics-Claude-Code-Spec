import type { FeatureFlagRepository } from '@tga/database';

/** One feature flag with a short in-process cache. Unknown flags are off (fail closed). */
export class FlagGate {
  private cache: { value: boolean; at: number } | undefined;

  constructor(
    private readonly flags: FeatureFlagRepository,
    private readonly key: string,
    private readonly ttlMs = 15_000,
  ) {}

  async enabled(): Promise<boolean> {
    const nowMs = Date.now();
    if (this.cache && nowMs - this.cache.at < this.ttlMs) return this.cache.value;
    const value = await this.flags.isEnabled(this.key);
    this.cache = { value, at: nowMs };
    return value;
  }
}
