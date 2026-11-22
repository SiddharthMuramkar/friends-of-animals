// Better Auth, configured for FOA and kept behind the identity module: only
// files in src/server/identity/ import it. It owns email sign-in codes
// (made, hashed, expired and counted by its email-OTP plugin) and database
// sessions. Phone codes are FOA's (./phone-code.ts), and a verified phone
// starts its session through `startVerifiedSession` below. FOA adds what
// it lacks: per-email and per-IP limits on codes (./rate-limit.ts), the
// use cases and can() (./policy.ts). FOA also sends the codes itself
// (./email-code.ts), so a failed send reaches the use case instead of
// being caught and logged by Better Auth, and creates accounts itself
// (./create-account.ts), so the welcome event is saved with them.
//
// No /api/auth/* route handler is mounted: every call goes through a use
// case, so Better Auth's own endpoints (which would skip FOA's limits) are
// not reachable over HTTP.

import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { emailOTP } from "better-auth/plugins/email-otp";
import { z } from "zod";

import type { AppDb } from "../db/app-db";
import { account, session, user, verification } from "../db/schema";
import type { Deps } from "../deps";
import { uuidv7 } from "../ids";
import { cappedSessionExpiry } from "../modules/second-factor/session-lifetimes";
import { SIGN_IN_CODE, SESSION_LIFETIME_DAYS } from "./settings";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Better Auth logs a failed background task with the error object, and a
 * database error's message lists the query's parameters (an address, a
 * code). Keep its warnings and errors, but only their message.
 */
const logger = {
  level: "warn" as const,
  log(level: "debug" | "info" | "warn" | "error", message: string) {
    const write = level === "error" ? console.error : console.warn;
    write(`[Better Auth] ${message}`);
  },
};

/**
 * Starts a session for a user FOA has already verified: verifyPhoneCode
 * calls it once a phone's code checks out, because Better Auth has no
 * phone flow for an encrypted number. Server-only: it is never on Better
 * Auth's HTTP router (and no /api/auth/* handler is mounted anyway), so
 * only FOA's own server code can reach it, through `auth.api`.
 */
const verifiedSessions = {
  id: "foa-verified-session",
  endpoints: {
    startVerifiedSession: createAuthEndpoint.serverOnly(
      { method: "POST", body: z.object({ userId: z.string() }) },
      async (ctx) => {
        const found = await ctx.context.internalAdapter.findUserById(
          ctx.body.userId
        );
        if (!found) throw new APIError("BAD_REQUEST");
        const session = await ctx.context.internalAdapter.createSession(
          found.id
        );
        await setSessionCookie(ctx, { session, user: found });
        return ctx.json({ userId: found.id });
      }
    ),
  },
} satisfies BetterAuthPlugin;

function createAuth({ db, clock, auth: config }: Deps) {
  return betterAuth({
    appName: "Friends of Animals",
    baseURL: config.baseUrl,
    secret: config.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: false },
    // An absolute lifetime (the HR-19 default): resolveActor reads sessions
    // with disableRefresh, so using the site never extends one.
    session: { expiresIn: SESSION_LIFETIME_DAYS * DAY_SECONDS },
    // Staff sessions are shorter (#60): a new session's expiry is capped by
    // its user's roles.
    databaseHooks: {
      session: {
        create: {
          async before(created) {
            const expiresAt = await cappedSessionExpiry(db, {
              userId: created.userId,
              createdAt: created.createdAt ?? clock.now(),
              expiresAt: created.expiresAt,
            });
            return { data: { ...created, expiresAt } };
          },
        },
      },
    },
    // FOA limits codes per email and per IP in Postgres; Better Auth's own
    // limiter keys on IP and path only, and its default store is memory,
    // which serverless instances don't share.
    rateLimit: { enabled: false },
    // A code's row is keyed "sign-in-otp-<address>", for addresses with no
    // account too. Store a SHA-256 of that key instead of the address.
    verification: { storeIdentifier: "hashed" },
    telemetry: { enabled: false },
    logger,
    advanced: {
      cookiePrefix: "foa",
      database: { generateId: () => uuidv7(clock.now()) },
      // Vercel sets x-forwarded-for to the client's address.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    plugins: [
      emailOTP({
        otpLength: SIGN_IN_CODE.length,
        expiresIn: SIGN_IN_CODE.lifetimeMinutes * 60,
        allowedAttempts: SIGN_IN_CODE.attempts,
        storeOTP: "hashed",
        // FOA creates accounts itself, with their welcome event in the same
        // transaction (./create-account.ts); a sign-in never creates one.
        disableSignUp: true,
        // requestEmailCode makes the code with createVerificationOTP and
        // sends it through the email port itself. Nothing FOA calls makes
        // Better Auth send one.
        sendVerificationOTP() {
          throw new Error("FOA sends sign-in codes from requestEmailCode");
        },
      }),
      verifiedSessions,
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One Better Auth instance per database: production has one; each Seam 1
// harness has its own.
const instances = new WeakMap<AppDb, Auth>();

export function authFor(deps: Deps): Auth {
  let auth = instances.get(deps.db);
  if (!auth) {
    auth = createAuth(deps);
    instances.set(deps.db, auth);
  }
  return auth;
}
