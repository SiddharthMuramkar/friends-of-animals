// A world on a real, migrated PostgreSQL for `pnpm test:pg`: races between
// separate connections, which PGlite (one serial connection) can't show.
// CI's pg-concurrency job migrates its service database and runs these;
// locally, point DIRECT_URL (or DATABASE_URL) at a throwaway database on
// this machine. The URL must pass the local seed's guard (notLocal in
// src/server/seed/target.ts): a host on this machine, no host the client
// could read differently, and not a deployed role or database, which
// PgBouncer or a tunnel can serve on loopback too.
//
//   const world = createPgWorld();
//   const admin = await world.signedIn(await world.seed.superAdmin(...));
//   await world.waitForLockWaiters(1);

import { randomBytes, randomUUID } from "node:crypto";
import { sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Actor } from "@/server/actor";
import { createApp, type UseCases } from "@/server/app";
import {
  createBlindIndex,
  type BlindIndexKey,
} from "@/server/crypto/blind-index";
import { createFieldCipher } from "@/server/crypto/field-cipher";
import * as schema from "@/server/db/schema";
import { session } from "@/server/db/schema";
import type { Deps } from "@/server/deps";
import { CONTACT_RATE_LIMITS } from "@/server/modules/contact/domain/submission";
import { CODE_REQUEST_LIMITS } from "@/server/identity/settings";
import { proofOfWorkHumanCheck } from "@/server/modules/public-forms/proof-of-work-check";
import { stampSession } from "@/server/modules/second-factor/session-factor";
import { createSeedBuilders, type SeedBuilders } from "@/server/seed";
import { notLocal } from "@/server/seed/target";

import { FakeClock } from "./fakes/clock";
import { FakeCookieJar } from "./fakes/cookies";
import { FakeEmail } from "./fakes/email";
import { FakeErrorReporter } from "./fakes/errors";
import { FakeMalwareScanner } from "./fakes/malware-scanner";
import { FakeMediaProcessor } from "./fakes/media";
import { FakePaymentGateway } from "./fakes/payment-gateway";
import { FakeSms } from "./fakes/sms";
import { FakeStorage } from "./fakes/storage";
import { TEST_AUTH, TEST_FILES, TEST_HUMAN_CHECK_DIFFICULTY } from "./harness";
import { TestSettings } from "./settings";

/** The test database's URL; refuses one that isn't on this machine. */
export function pgTestUrl(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "pnpm test:pg needs DIRECT_URL (or DATABASE_URL) naming a migrated " +
        "throwaway database on this machine."
    );
  }
  const refused = notLocal(url, "pnpm test:pg");
  if (refused) throw new Error(refused);
  return url;
}

export type PgWorld = ReturnType<typeof createPgWorld>;

/**
 * Use cases over a pool on the test database, with the harness's fakes
 * and a clock at the real time. `sql` is a separate client for holding
 * locks the way another request would. Call `close()` in afterAll.
 */
export function createPgWorld() {
  const url = pgTestUrl();
  // Enough connections for a use case, a racing request and a check.
  const client = postgres(url, { max: 6, prepare: false, onnotice: () => {} });
  const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const clock = new FakeClock(new Date());
  const gateway = new FakePaymentGateway();
  const deps: Deps = {
    appEnv: "local",
    db,
    clock,
    email: new FakeEmail(clock),
    sms: new FakeSms(clock),
    cookies: new FakeCookieJar(clock),
    auth: TEST_AUTH,
    cipher: createFieldCipher({
      primary: 1,
      keys: new Map([[1, randomBytes(32)]]),
    }),
    blindIndex: createBlindIndex(randomBytes(32) as BlindIndexKey),
    settings: new TestSettings({ db, clock }),
    storage: new FakeStorage(clock),
    files: TEST_FILES,
    errors: new FakeErrorReporter(),
    scanner: new FakeMalwareScanner(),
    media: new FakeMediaProcessor(),
    humanCheck: proofOfWorkHumanCheck({
      secret: TEST_AUTH.secret,
      difficulty: TEST_HUMAN_CHECK_DIFFICULTY,
    }),
    contactLimits: CONTACT_RATE_LIMITS,
    codeRequestLimits: CODE_REQUEST_LIMITS,
    payments: gateway,
  };
  const app = createApp(deps);
  const seed: SeedBuilders = createSeedBuilders(deps);

  return {
    db,
    sql,
    clock,
    gateway,
    seed,
    as: (actor: Actor): UseCases => app.as(actor),
    /** An address no other test in the shared database uses. */
    uniqueEmail: () => `pg-${randomUUID()}@example.test`,
    /**
     * A live session for `user`, as signing in makes. With
     * `secondFactor`, the session has also just passed one (the user must
     * hold a factor, e.g. `seed.authenticator`).
     */
    async signedIn(
      user: { id: string },
      { secondFactor = false }: { secondFactor?: boolean } = {}
    ): Promise<Extract<Actor, { kind: "user" }>> {
      const now = clock.now();
      const id = randomUUID();
      await db.insert(session).values({
        id,
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      });
      if (secondFactor) await stampSession(db, id, now, "totp");
      return {
        kind: "user",
        userId: user.id,
        sessionId: id,
        meta: { ip: "203.0.113.20", userAgent: "pg concurrency test" },
      };
    },
    /**
     * Resolves once at least `n` backends on this database wait for a
     * row lock; rejects after `timeoutMs`.
     */
    async waitForLockWaiters(n: number, timeoutMs = 3000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // postgres-js's execute() returns the rows as an array. PGlite's
        // returns { rows }, so don't copy this indexing into PGlite code.
        const [row] = await db.execute<{ n: number }>(raw`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `);
        if ((row?.n ?? 0) >= n) return;
        if (Date.now() > deadline) {
          throw new Error(`Fewer than ${n} backends waited for a lock`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    async close() {
      await Promise.all([client.end(), sql.end()]);
    },
  };
}
