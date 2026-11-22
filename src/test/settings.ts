import { setting } from "@/server/db/schema";
import type { AppDb, DbWithClock } from "@/server/db/app-db";
import type { Clock } from "@/server/ports/clock";
import {
  databaseSettings,
  type SettingKey,
  type SettingValue,
} from "@/server/modules/settings";
import type { Settings } from "@/server/ports/settings";

/**
 * Runtime settings for Seam 1 tests, over the test database's settings
 * table, as in production: every setting reads its default until a test
 * stores one with `set` (or a super admin changes it with changeSetting).
 */
export class TestSettings implements Settings {
  readonly #db: AppDb;
  readonly #clock: Clock;
  readonly #settings: Settings;

  constructor({ db, clock }: DbWithClock) {
    this.#db = db;
    this.#clock = clock;
    this.#settings = databaseSettings(db);
  }

  get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return this.#settings.get(key);
  }

  /**
   * Stores `value` for `key`, as a seed would: no admin, no step-up, no
   * audit entry. Tests of the settings screen use changeSetting instead.
   */
  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>
  ): Promise<void> {
    const updatedAt = this.#clock.now();
    await this.#db
      .insert(setting)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: setting.key,
        set: { value, updatedAt, updatedByUserId: null },
      });
  }
}
