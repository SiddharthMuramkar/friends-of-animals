import type { DbWithClock } from "@/server/db/app-db";
import { setting } from "@/server/db/schema";
import { isSettingKey, storedSettings } from "@/server/modules/settings";
import {
  FIXED_SETTINGS,
  type FixedSettingKey,
  type FixedSettingValues,
  type SettingKey,
  type Settings,
  type SettingValues,
} from "@/server/ports/settings";

/**
 * Runtime settings for Seam 1 tests, read the way the app reads them: from
 * this harness's settings table (storedSettings), so a super admin's
 * changeSetting counts. Every setting starts at its default (SMS off).
 * `await h.settings.set("sms.enabled", true)` stores a value as seed data
 * would: no user, no audit entry. A fixed setting, not on the settings
 * screen yet, changes for this harness only.
 */
export class TestSettings implements Settings {
  readonly #deps: DbWithClock;
  readonly #fixed: FixedSettingValues = { ...FIXED_SETTINGS };
  readonly #stored: Settings;

  constructor(deps: DbWithClock) {
    this.#deps = deps;
    this.#stored = storedSettings(deps.db, this.#fixed);
  }

  get<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
    return this.#stored.get(key);
  }

  async set<K extends SettingKey>(
    key: K,
    value: SettingValues[K]
  ): Promise<void> {
    if (!isSettingKey(key)) {
      const fixed = key as FixedSettingKey;
      this.#fixed[fixed] = value as FixedSettingValues[typeof fixed];
      return;
    }
    const updatedAt = this.#deps.clock.now();
    await this.#deps.db
      .insert(setting)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: setting.key,
        set: { value, updatedAt, updatedByUserId: null },
      });
  }
}
