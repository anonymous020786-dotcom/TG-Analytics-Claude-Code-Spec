import type { Database } from '../client';

export class FeatureFlagRepository {
  constructor(private readonly db: Database) {}

  /** Unknown flags are off (fail closed for risky features). */
  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.db.featureFlag.findUnique({ where: { key } });
    return flag?.enabled ?? false;
  }

  async set(key: string, enabled: boolean, description?: string): Promise<void> {
    await this.db.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description: description ?? null },
      update: { enabled, ...(description === undefined ? {} : { description }) },
    });
  }
}
