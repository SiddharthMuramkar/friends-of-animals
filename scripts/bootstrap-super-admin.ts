// Makes one account a global super admin (`pnpm admin:bootstrap-super-admin
// --email <address> [--name <name>]`), creating a verified account if the
// address has none. Only a super admin can grant roles in the app, so this
// is how the first one is made on a new database, production included. The
// grant goes through grantRole as the platform's command line, so the
// audit log records it.
//
// It connects through DIRECT_URL, like the migration (on a preview, to the
// preview's own database). Running it again changes nothing.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { migrationEnvSchema, parseEnv } from "../src/env.schema";
import { bootstrapSuperAdmin } from "../src/server/access/bootstrap";
import { directTls, migrationTarget } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { systemClock } from "../src/server/ports/clock";
import { parseBootstrapArgs } from "./bootstrap-super-admin-args";
import { loadEnvFiles } from "./load-env";

const args = parseBootstrapArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.error);
  process.exit(2);
}

loadEnvFiles();

let url: string;
try {
  ({ url } = migrationTarget(parseEnv(migrationEnvSchema, process.env)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const client = postgres(url, {
  ...directTls(url),
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});

try {
  const { userId, changed } = await bootstrapSuperAdmin(
    { db: drizzle({ client, schema }), clock: systemClock },
    { email: args.email, name: args.name }
  );
  console.log(
    changed
      ? `User ${userId} is now a global super admin.`
      : `User ${userId} already was a global super admin; nothing changed.`
  );
  await client.end();
} catch (error) {
  console.error("Bootstrap failed:", error);
  await client.end({ timeout: 5 });
  process.exit(1);
}
