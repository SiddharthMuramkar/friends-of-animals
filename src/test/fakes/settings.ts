import {
  SETTING_DEFAULTS,
  type SettingKey,
  type Settings,
  type SettingValues,
} from "@/server/ports/settings";

/**
 * Runtime settings for Seam 1 tests: every setting starts at its default
 * (SMS off), and a test changes one with `set`, as staff would on #62's
 * screen.
 */
export class FakeSettings implements Settings {
  readonly #values: SettingValues = { ...SETTING_DEFAULTS };

  async get<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
    return this.#values[key];
  }

  set<K extends SettingKey>(key: K, value: SettingValues[K]): void {
    this.#values[key] = value;
  }
}
