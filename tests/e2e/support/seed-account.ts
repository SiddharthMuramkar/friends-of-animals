import { test as base } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { loadEnvFiles } from "../../../scripts/load-env";
import {
  fieldKeyEnvSchema,
  migrationEnvSchema,
  parseEnv,
} from "../../../src/env.schema";
import type { Grant } from "../../../src/server/access/domain/roles";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import { DEVELOPMENT_AUTH_SECRET } from "../../../src/server/identity/settings";
import { ensureVerifiedAccount } from "../../../src/server/identity/verified-account";
import { uuidv7 } from "../../../src/server/ids";
import { sealTotpSecret } from "../../../src/server/modules/second-factor/secret-box";
import { systemClock } from "../../../src/server/ports/clock";
import { ensureGrant } from "../../../src/server/seed/access";
import { SEED_FACTOR_LABEL } from "../../../src/server/seed/second-factor";
import { seedTarget } from "../../../src/server/seed/target";

export type SeedAccount = (details: {
  name: string;
  grants: Grant[];
  totpSecret?: Uint8Array;
}) => Promise<string>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The database a local app server at `baseURL` runs on, for fixtures that
 * seed it; throws for any other server or APP_ENV.
 */
export function localSeedUrl(baseURL: string | undefined): string {
  if (!baseURL || !LOOPBACK_HOSTS.has(new URL(baseURL).hostname)) {
    throw new Error("Playwright account fixtures require a local app server.");
  }
  const config = parseEnv(migrationEnvSchema, process.env);
  if ((config.APP_ENV ?? "local") !== "local") {
    throw new Error("Playwright account fixtures require APP_ENV=local.");
  }
  const target = seedTarget(config);
  if (!target.seed) throw new Error(target.reason);
  return target.url;
}

export const test = base.extend<{ seedAccount: SeedAccount }>({
  seedAccount: async ({ baseURL }, use, { project }) => {
    loadEnvFiles();
    const url = localSeedUrl(baseURL);
    const fieldCrypto = fieldCryptoFor(
      parseEnv(fieldKeyEnvSchema, process.env)
    );
    const auth = {
      secret: process.env.BETTER_AUTH_SECRET || DEVELOPMENT_AUTH_SECRET,
    };
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const accountIds: string[] = [];

    try {
      await use(async ({ name, grants, totpSecret }) => {
        // The mailbox and authenticator state are private to this test, even
        // when both projects or repeated runs share the same database.
        const now = systemClock.now();
        const id = uuidv7(now);
        const email = `e2e+${project.name}-${id}@example.test`;
        try {
          await db.transaction(async (tx) => {
            const deps = { db: tx, clock: systemClock, ...fieldCrypto, auth };
            const account = await ensureVerifiedAccount(deps, {
              id,
              name,
              email,
            });
            if (account.id !== id)
              throw new Error("Fixture email already exists.");
            for (const grant of grants) await ensureGrant(deps, id, grant);
            if (totpSecret) {
              const factorId = uuidv7(now);
              await tx.insert(schema.secondFactor).values({
                id: factorId,
                userId: id,
                kind: "totp",
                label: SEED_FACTOR_LABEL,
                confirmedAt: now,
                createdAt: now,
                totpSecretSealed: sealTotpSecret(
                  auth.secret,
                  factorId,
                  totpSecret
                ),
              });
            }
          });
        } catch {
          // Drizzle errors can include bound values from the seed transaction.
          throw new Error(
            "Could not seed a Playwright account on the local database."
          );
        }
        accountIds.push(id);
        return email;
      });
    } finally {
      try {
        if (accountIds.length > 0) {
          await db
            .delete(schema.user)
            .where(inArray(schema.user.id, accountIds));
        }
      } finally {
        await client.end({ timeout: 5 });
      }
    }
  },
});
