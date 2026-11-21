// Makes the first global super admin (`pnpm admin:bootstrap-super-admin
// --email <address> [--name <name>] [--target <host>/<database>]`),
// creating a verified account if the address has none. Only a super admin
// can grant roles in the app, so this is how the first one is made on a
// new database, production included. It refuses once any global super
// admin exists; later ones are granted in the app. The grant goes through
// grantRole as the platform's command line, so the audit log records it.
//
// It connects through DIRECT_URL, like the migration (on a preview, to the
// preview's own database), and says which host and database first. A
// database on another machine needs `--target <host>/<database>` naming
// the same one, so a stray DIRECT_URL can't be bootstrapped by mistake.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { migrationEnvSchema, parseEnv } from "../src/env.schema";
import { bootstrapSuperAdmin } from "../src/server/access/bootstrap";
import { directTls, migrationTarget } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { errorSummaryForLogs } from "../src/server/errors";
import { systemClock } from "../src/server/ports/clock";
import {
  bootstrapTarget,
  parseBootstrapArgs,
} from "./bootstrap-super-admin-args";
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

const target = bootstrapTarget(url, args.target);
if (!target.ok) {
  console.error(target.error);
  process.exit(2);
}
console.log(`Target: ${target.host}/${target.database}`);

const client = postgres(url, {
  ...directTls(url),
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});

try {
  const result = await bootstrapSuperAdmin(
    { db: drizzle({ client, schema }), clock: systemClock },
    { email: args.email, name: args.name }
  );
  await client.end();
  if (!result.ok) {
    console.error(
      "Refused: a global super admin already exists. Grant further roles in the app; nothing was written."
    );
    process.exit(1);
  }
  console.log(`User ${result.userId} is now a global super admin.`);
} catch (error) {
  // Only the error's class and Postgres code: a failed query's message
  // lists its parameters, the address included.
  console.error(`Bootstrap failed: ${errorSummaryForLogs(error)}`);
  await client.end({ timeout: 5 });
  process.exit(1);
}
