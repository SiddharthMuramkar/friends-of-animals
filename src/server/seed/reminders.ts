// Reminders seed data (#84): the seeded competitions are inserted rather
// than published, so this plans their reminders the way publishing does:
// one reminder_job row per offset still ahead, each with its delayed
// `reminder.due` event. Nothing is sent now; a local worker left running
// until a fire time would send it. Idempotent: a second run keeps what is
// planned and plans nothing more.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { syncReminders } from "../modules/reminders/schedule-reminders";
import { databaseSettings } from "../modules/settings/read";
import type { SeedDeps } from "./types";

export async function seedReminders(deps: SeedDeps): Promise<void> {
  await syncReminders({
    db: deps.db,
    clock: deps.clock,
    settings: databaseSettings(deps.db),
    actor: { kind: "system", process: "seed" },
  });
}
