// The Seam 1 harness (#55 "Testing Decisions"). A test builds one harness,
// sets up its world with seed builders, calls use cases exactly as server
// actions do, and asserts on what came back, what the fakes received and
// which rows exist:
//
//   const h = await createHarness();
//   const member = await h.seed.member();
//   await h.as(h.visitor()).requestEmailCode({ email: member.email });
//   expect(h.email.codeFor(member.email)).toMatch(/^\d{6}$/);
//
// Each harness has its own PGlite database (real migrations), fake clock and
// fakes, so tests share nothing. Tickets that add a port append its fake
// here and in src/server/deps.ts. Outbox events are not a port: `drain()`
// runs the real relay over these deps. See docs/agents/seam-1.md.

import { randomBytes } from "node:crypto";
import { onTestFinished, vi } from "vitest";

import { createApp, type UseCases } from "@/server/app";
import {
  createBlindIndex,
  type BlindIndexKey,
} from "@/server/crypto/blind-index";
import { createFieldCipher } from "@/server/crypto/field-cipher";
import type { Actor, RequestMeta } from "@/server/actor";
import type { Deps } from "@/server/deps";
import { resolveActor } from "@/server/identity";
import { headersFor } from "@/server/identity/request";
import { isStaffRole } from "@/server/access/domain/roles";
import { grantsOf } from "@/server/access/grants";
import { base32Decode } from "@/server/modules/second-factor/domain/base32";
import { TOTP, totpCode } from "@/server/modules/second-factor/domain/totp";
import { isEnrolled } from "@/server/modules/second-factor/session-factor";
import { drainUntilIdle, type DrainReport } from "@/server/outbox";
import { createSeedBuilders, type SeedBuilders } from "@/server/seed";
import { SEED_TOTP_SECRET } from "@/server/seed/second-factor";

import { createTestDb, type TestDb } from "./db";
import { FakeClock } from "./fakes/clock";
import { FakeCookieJar } from "./fakes/cookies";
import { FakeEmail } from "./fakes/email";
import { FakeSettings } from "./fakes/settings";
import { FakeSms } from "./fakes/sms";
import { FakeErrorReporter } from "./fakes/errors";
import { FakeMalwareScanner } from "./fakes/malware-scanner";
import { FakeMediaProcessor } from "./fakes/media";
import { FakeStorage } from "./fakes/storage";

export interface Harness {
  /** This test's database. Assert on rows through it. */
  db: TestDb;
  /**
   * Starts at DEFAULT_TEST_INSTANT unless `now` was given. The system clock
   * follows it (Date only), because Better Auth reads `new Date()`.
   */
  clock: FakeClock;
  /** Every email use cases sent. */
  email: FakeEmail;
  /** Every SMS use cases sent. */
  sms: FakeSms;
  /**
   * Runtime settings, at their defaults (SMS off) until a test sets one:
   * `h.settings.set("sms.enabled", true)`.
   */
  settings: FakeSettings;
  /** The browser's cookie store: what use cases set on responses. */
  cookies: FakeCookieJar;
  /** Every error use cases reported, scrubbed as Sentry would get it. */
  errors: FakeErrorReporter;
  /** What use cases run against: the fakes above plus test auth config. */
  deps: Deps;
  /** The use cases, acting as `actor`: the same ones server actions call. */
  as(actor: Actor): UseCases;
  /** A signed-out caller. */
  visitor(meta?: Partial<RequestMeta>): Actor;
  /**
   * Who the server sees on the browser's next request: resolved from its
   * cookies the way `currentActor()` does it in production. Pass `cookie`
   * (a Cookie header saved earlier with `cookies.header()`) to ask about
   * another browser.
   */
  currentActor(meta?: Partial<RequestMeta>, cookie?: string): Promise<Actor>;
  /**
   * Signs `user` in through the real email-code flow (from a fresh IP, so
   * it doesn't eat into a test's own limits) and returns the signed-in
   * actor. The browser then holds that session. A user holding a staff
   * role then passes their second factor too (`passSecondFactor`), as
   * staff do before any staff screen; `{ secondFactor: false }` stops
   * after the email code.
   */
  signIn(
    user: { email: string },
    meta?: Partial<RequestMeta>,
    options?: { secondFactor?: boolean }
  ): Promise<Actor>;
  /**
   * Passes the second factor for `actor`'s session with a code from the
   * seed authenticator (SEED_TOTP_SECRET), through verifySecondFactor.
   * A user with no factor first gets the seed authenticator.
   */
  passSecondFactor(actor: Actor): Promise<void>;
  /** The seed authenticator's code at `at` (default: now). */
  totpCode(at?: Date): string;
  /** Builders that write to this database with this clock. */
  seed: SeedBuilders;
  /**
   * Delivers every outbox event due now, in process, the way the worker
   * does (the same relay, on this database, fakes and clock), until a pass
   * finds nothing due. Retries wait for `clock.advance()`.
   */
  drain(): Promise<DrainReport>;
  /**
   * The private buckets. `put(url, bytes, headers)` and `get(url)` use a
   * presigned URL as the browser does, checked against the fake clock.
   */
  storage: FakeStorage;
  /**
   * Flags the EICAR test file (src/test/eicar.ts); counts scans and fails
   * the next ones with `failNext(n)`.
   */
  scanner: FakeMalwareScanner;
  /**
   * Makes derivatives from image headers without decoding pixels; records
   * its inputs and fails the next ones with `failNext(n, code)`.
   */
  media: FakeMediaProcessor;
}

/** Documentation addresses (RFC 5737) and an obvious user agent. */
const DEFAULT_META: RequestMeta = {
  ip: "203.0.113.10",
  userAgent: "Seam 1 test",
};

export const TEST_AUTH = {
  secret: "seam-1-test-secret-0123456789abcdef",
  baseUrl: "http://localhost:3000",
};

/** A local run's files config: test uploads allowed, under `local/`. */
export const TEST_FILES = {
  bucket: "foa-files-test",
  keyPrefix: "local/",
  appEnv: "local",
} as const;

export async function createHarness(
  options: { now?: Date | string } = {}
): Promise<Harness> {
  const db = await createTestDb();
  // Close the database when the test ends. Left open, Postgres's timers,
  // set by the faked Date, sit weeks ahead once Date is real again, and
  // Node prints TimeoutOverflowWarning for each. (So call createHarness()
  // in a test or beforeEach, not beforeAll.)
  onTestFinished(() => db.$client.close());
  vi.useFakeTimers({ toFake: ["Date"] });
  const clock = new FakeClock(options.now, {
    onChange: (now) => vi.setSystemTime(now),
  });
  const email = new FakeEmail(clock);
  const sms = new FakeSms(clock);
  const settings = new FakeSettings();
  const cookies = new FakeCookieJar(clock);
  const errors = new FakeErrorReporter();
  const storage = new FakeStorage(clock);
  const scanner = new FakeMalwareScanner();
  const media = new FakeMediaProcessor();
  const deps: Deps = {
    db,
    clock,
    email,
    sms,
    cookies,
    auth: TEST_AUTH,
    // Fresh keys per harness, as a deployment has its own.
    cipher: createFieldCipher({
      primary: 1,
      keys: new Map([[1, randomBytes(32)]]),
    }),
    blindIndex: createBlindIndex(randomBytes(32) as BlindIndexKey),
    settings,
    errors,
    storage,
    files: TEST_FILES,
    scanner,
    media,
  };
  const app = createApp(deps);
  const meta = (overrides: Partial<RequestMeta> = {}) => ({
    ...DEFAULT_META,
    ...overrides,
  });
  let signIns = 0;

  const harness: Harness = {
    db,
    clock,
    email,
    sms,
    settings,
    cookies,
    errors,
    deps,
    as: (actor) => app.as(actor),
    visitor: (overrides) => ({ kind: "visitor", meta: meta(overrides) }),
    currentActor: (overrides, cookie = cookies.header()) =>
      resolveActor(deps, headersFor(meta(overrides), cookie)),
    async signIn(user, overrides, options = {}) {
      signIns += 1;
      const visitor = harness.visitor({
        ip: `198.18.0.${signIns}`,
        ...overrides,
      });
      const requested = await app.as(visitor).requestEmailCode(user);
      const code = email.codeFor(user.email);
      if (!requested.ok || !code) {
        throw new Error(`Could not send a code to ${user.email}`);
      }
      const verified = await app
        .as(visitor)
        .verifyEmailCode({ intent: "sign-in", email: user.email, code });
      if (!verified.ok) {
        throw new Error(`Could not sign ${user.email} in: ${verified.error}`);
      }
      const actor = await harness.currentActor(
        visitor.kind === "visitor" ? visitor.meta : {}
      );
      if (
        options.secondFactor !== false &&
        actor.kind === "user" &&
        (await grantsOf(db, actor.userId)).some((grant) =>
          isStaffRole(grant.role)
        )
      ) {
        await harness.passSecondFactor(actor);
      }
      return actor;
    },
    async passSecondFactor(actor) {
      if (actor.kind !== "user") {
        throw new Error(`A ${actor.kind} has no second factor to pass`);
      }
      if (!(await isEnrolled(db, actor.userId))) {
        await harness.seed.authenticator({ id: actor.userId });
      }
      // A code works once, so a second session in the same 30 seconds
      // types the next one, which the one step of drift allows.
      const now = clock.now().getTime();
      let result;
      for (const at of [now, now + TOTP.periodSeconds * 1000]) {
        result = await app
          .as(actor)
          .verifySecondFactor({ code: harness.totpCode(new Date(at)) });
        if (result.ok) return;
      }
      throw new Error(
        `Could not pass the second factor: ${JSON.stringify(result)}. ` +
          "Advance the clock between sign-ins, or use the user's own factor."
      );
    },
    totpCode: (at = clock.now()) =>
      totpCode(base32Decode(SEED_TOTP_SECRET), at),
    seed: createSeedBuilders(deps),
    // Every queue, worker-media's included.
    drain: () => drainUntilIdle(deps, { queue: "all" }),
    storage,
    scanner,
    media,
  };
  return harness;
}
