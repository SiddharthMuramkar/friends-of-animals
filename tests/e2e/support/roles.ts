import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { migrationEnvSchema, parseEnv } from "../../../src/env.schema";
import type { Role } from "../../../src/server/access/domain/roles";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { DEVELOPMENT_AUTH_SECRET } from "../../../src/server/identity/settings";
import { systemClock } from "../../../src/server/ports/clock";
import { ensureGrant } from "../../../src/server/seed/access";
import { seedTarget } from "../../../src/server/seed/target";

/**
 * Gives the account at `email` the global `role` in the database the server
 * runs on, the way the preview seed grants its accounts' roles. No screen
 * grants roles yet (59b), and a journey that needs a role can't share the
 * seeded staff's authenticator with other journeys running at the same
 * time: a code works once per authenticator. Like `pnpm db:seed`, it
 * writes only to a local or preview database (seedTarget), through
 * DIRECT_URL, which CI's E2E job sets.
 */
export async function grantGlobalRole(
  email: string,
  role: Role
): Promise<void> {
  const target = seedTarget(parseEnv(migrationEnvSchema, process.env));
  if (!target.seed) throw new Error(`Not granting ${role}. ${target.reason}`);
  const client = postgres(target.url, {
    ...directTls(target.url),
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
  try {
    const db = drizzle({ client, schema });
    const [account] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!account) throw new Error(`No account to grant ${role} to.`);
    await ensureGrant(
      {
        db,
        clock: systemClock,
        // As the seed script picks it; granting a role doesn't use it.
        auth: {
          secret: process.env.BETTER_AUTH_SECRET || DEVELOPMENT_AUTH_SECRET,
        },
      },
      account.id,
      { role, scope: { type: "global" } }
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
