// Settings seed data (#62): the first settings, stored at their defaults,
// so a preview's settings screen lists stored rows from the start. Loads
// under plain Node (the seed script): relative imports only, no
// "server-only".

import { setting } from "../db/schema";
import {
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type SettingValue,
} from "../modules/settings/catalogue";
import type { SeedDeps } from "./types";

/**
 * Where a preview or a local run differs from the defaults. Only they are
 * seeded (staging and production never are), and they send every text to
 * the capture mailbox, so SMS is on there: sign-in by phone works, and
 * the Seam 2 journey uses it.
 */
const PREVIEW_VALUES: { [K in SettingKey]?: SettingValue<K> } = {
  "sms.enabled": true,
};

/**
 * Stores each setting's preview value unless a value is stored already,
 * so a value someone changed on the preview survives every later seed.
 * Seed data, not an admin's change: it names no user and writes no audit
 * entry.
 *
 * The trade-off, accepted for the brief's seeded settings (AC 8): a seeded
 * database shows every setting as stored, changed on the seed's date, not
 * as using the default. A default changed later in the catalogue doesn't
 * reach a database seeded before: its stored row keeps the old one until a
 * super admin changes it on the settings screen.
 */
export async function seedSettings({ db, clock }: SeedDeps): Promise<void> {
  const now = clock.now();
  await db
    .insert(setting)
    .values(
      SETTING_KEYS.map((key) => ({
        key,
        value: PREVIEW_VALUES[key] ?? SETTINGS[key].default,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing({ target: setting.key });
}
