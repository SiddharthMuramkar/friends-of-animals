// Settings seed data (#62): every setting stored, so a preview's settings
// screen lists stored rows from the start. Loads under plain Node (the
// seed script): relative imports only, no "server-only".

import { setting } from "../db/schema";
import {
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type SettingValue,
} from "../modules/settings/catalogue";
import type { SeedDeps } from "./types";

/**
 * Where the seed differs from the defaults. Only local runs and previews
 * are seeded, and they capture every text (smsSenderFor), so sign-in by
 * phone is on there: #58's journey uses it. So is erasure, on fake data. Staging and production are
 * never seeded and keep the default, off, until DLT approval (HR-14).
 * Donations are on there too (#106); production keeps them off until
 * HR-15 and HR-47.
 */
const SEEDED: { [K in SettingKey]?: SettingValue<K> } = {
  "sms.enabled": true,
  // The accountant's export waits for HR-47 in production (#109).
  "ledger.accountantExport": true,
  // Local runs and previews pay through the test checkout (#106).
  "auctions.enabled": true,
  "donations.enabled": true,
  "donations.recurringEnabled": true,
  // Erasure (#115b) waits for counsel in production (HR-30); seeded data
  // is fake, so a local run or preview can try it end to end.
  "privacy.erasureEnabled": true,
  // Volunteer applications (#123) open where nothing is real; production
  // keeps them closed until HR-55 and HR-38.
  "surveys.enabled": true,
  "volunteers.applicationsOpen": true,
};

/**
 * Stores each setting's seeded value unless a value is stored already, so
 * a value someone changed on the preview survives every later seed. Seed
 * data, not an admin's change: it names no user and writes no audit entry.
 *
 * The trade-off, accepted for #62's seeded settings: a seeded database
 * shows every setting as stored, changed on the seed's date, not as using
 * the default. A default changed later in the catalogue doesn't reach a
 * database seeded before: its stored row keeps the old one until a super
 * admin changes it on the settings screen.
 */
export async function seedSettings({ db, clock }: SeedDeps): Promise<void> {
  const now = clock.now();
  await db
    .insert(setting)
    .values(
      SETTING_KEYS.map((key) => ({
        key,
        value: SEEDED[key] ?? SETTINGS[key].default,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing({ target: setting.key });
}
