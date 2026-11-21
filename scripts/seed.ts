// Fills a preview or local database with seed data (`pnpm db:seed`): a
// super admin and a few members today, more as modules add seeders
// (src/server/seed/index.ts). Idempotent, so it runs after every migration.
//
// It connects through DIRECT_URL, like the migration, to the same database:
// on a preview, the preview's own. Staging and production are never seeded:
// it exits 0 without connecting, so `vercel-build` can always run it. A
// local run (APP_ENV local or unset) seeds only a database on this machine
// or the Compose `db` service, and exits 0 for any other host.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  fieldKeyEnvSchema,
  migrationEnvSchema,
  parseEnv,
} from "../src/env.schema";
import { fieldCryptoFor, type FieldCrypto } from "../src/server/crypto/keys";
import { directTls } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { DEVELOPMENT_AUTH_SECRET } from "../src/server/identity/settings";
import { systemClock } from "../src/server/ports/clock";
import { seedPreview } from "../src/server/seed";
import { seedTarget } from "../src/server/seed/target";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

let target: ReturnType<typeof seedTarget>;
try {
  target = seedTarget(parseEnv(migrationEnvSchema, process.env));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (!target.seed) {
  console.log(`Not seeding. ${target.reason}`);
  process.exit(0);
}

let fieldCrypto: FieldCrypto;
try {
  // The same keys as the app on this deployment, so it can find and read
  // the seeded phone: the public development keys when none are set.
  fieldCrypto = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { url } = target;
const client = postgres(url, {
  ...directTls(url),
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});

try {
  console.log(`Seeding ${new URL(url).pathname.slice(1)}...`);
  await seedPreview({
    db: drizzle({ client, schema }),
    clock: systemClock,
    ...fieldCrypto,
    // The app's own secret, as productionDeps() picks it: seeded staff
    // authenticators are sealed with it.
    auth: {
      secret: process.env.BETTER_AUTH_SECRET || DEVELOPMENT_AUTH_SECRET,
    },
  });
  console.log("Seed complete.");
  await client.end();
} catch (error) {
  console.error("Seed failed:", error);
  await client.end({ timeout: 5 });
  process.exit(1);
}
