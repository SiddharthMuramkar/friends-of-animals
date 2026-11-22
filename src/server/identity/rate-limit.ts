// Postgres-backed limits on sign-in codes, per identifier (an email
// address or a phone number) and per IP (#55: "Postgres-backed rate
// limits apply per identifier and per IP"), and per identifier per day.
// The IP counter is shared: email and phone codes from one IP count
// together. Texts also count against a ceiling for everyone together, per
// hour and per day, which caps FOA's SMS bill.
//
// Fixed windows: each request adds one to each counter for its current
// window with an atomic upsert; a request that would pass any limit is
// rolled back, so refused requests don't count. Keys are HMACs, so the
// table holds no address, number or IP. An IP counts by its network
// (ipNetwork): one IPv6 connection holds a whole /64, and would otherwise
// get a fresh allowance per address.

import { createHmac } from "node:crypto";

import { lt, sql } from "drizzle-orm";

import { ipNetwork } from "@/lib/ip-network";

import type { AppDb } from "../db/app-db";
import { otpRateLimit, type OtpRateLimitScope } from "../db/schema";
import { CODE_REQUEST_LIMITS } from "./settings";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Allowance = { ok: true } | { ok: false; retryAfterSeconds: number };

class LimitReached extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("limit reached");
  }
}

function keyHash(secret: string, scope: OtpRateLimitScope, value: string) {
  return createHmac("sha256", secret)
    .update(`otp-rate-limit:${scope}:${value}`)
    .digest("base64url");
}

/** The fixed window of `windowMs` that `now` falls in. */
function windowAt(now: Date, windowMs: number) {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return {
    start: new Date(start),
    retryAfterSeconds: Math.ceil((start + windowMs - now.getTime()) / 1000),
  };
}

/** The most texts per hour and per day, to everyone together. */
export type SmsCeiling = { perHour: number; perDay: number };

/**
 * Who a code goes to: an email address, or a phone number in E.164 with
 * the ceiling its text counts against.
 */
export type CodeRecipient =
  | { channel: "email"; key: string }
  | { channel: "phone"; key: string; smsCeiling: SmsCeiling };

const DAY_SCOPE = { email: "email_day", phone: "phone_day" } as const;

/** The key of the counters that count every text. */
const EVERYONE = "everyone";

type Counter = {
  scope: OtpRateLimitScope;
  key: string;
  limit: number;
  windowMs: number;
};

function countersFor(to: CodeRecipient, ip: string): Counter[] {
  const windowMs = CODE_REQUEST_LIMITS.windowMinutes * MINUTE_MS;
  const counters: Counter[] = [
    {
      scope: to.channel,
      key: to.key,
      limit: CODE_REQUEST_LIMITS.perRecipient,
      windowMs,
    },
    {
      scope: "ip",
      key: ipNetwork(ip),
      limit: CODE_REQUEST_LIMITS.perIp,
      windowMs,
    },
    {
      scope: DAY_SCOPE[to.channel],
      key: to.key,
      limit: CODE_REQUEST_LIMITS.perRecipientPerDay,
      windowMs: DAY_MS,
    },
  ];
  if (to.channel === "phone") {
    counters.push(
      {
        scope: "sms_hour",
        key: EVERYONE,
        limit: to.smsCeiling.perHour,
        windowMs: HOUR_MS,
      },
      {
        scope: "sms_day",
        key: EVERYONE,
        limit: to.smsCeiling.perDay,
        windowMs: DAY_MS,
      }
    );
  }
  return counters;
}

/**
 * Takes one code from the recipient's and the IP's allowance for this
 * window, from the recipient's allowance for the day, and for a text from
 * the ceiling for everyone this hour and today; or reports when the last
 * of the full windows ends.
 */
export async function takeCodeAllowance(
  db: AppDb,
  {
    to,
    ip,
    now,
    secret,
  }: { to: CodeRecipient; ip: string; now: Date; secret: string }
): Promise<Allowance> {
  const counters = countersFor(to, ip);

  try {
    await db.transaction(async (tx) => {
      // Check every counter: with two full, the visitor must wait for the
      // later one to reopen.
      let wait = 0;
      for (const { scope, key, limit, windowMs: length } of counters) {
        const window = windowAt(now, length);
        const [row] = await tx
          .insert(otpRateLimit)
          .values({
            scope,
            keyHash: keyHash(secret, scope, key),
            windowStart: window.start,
            count: 1,
          })
          .onConflictDoUpdate({
            target: [
              otpRateLimit.scope,
              otpRateLimit.keyHash,
              otpRateLimit.windowStart,
            ],
            set: { count: sql`${otpRateLimit.count} + 1` },
          })
          .returning({ count: otpRateLimit.count });
        if (!row || row.count > limit) {
          wait = Math.max(wait, window.retryAfterSeconds);
        }
      }
      if (wait > 0) throw new LimitReached(wait);
      // Windows that started over a day ago have ended: even a day's
      // window starts at most a day before now.
      await tx
        .delete(otpRateLimit)
        .where(lt(otpRateLimit.windowStart, new Date(now.getTime() - DAY_MS)));
    });
  } catch (error) {
    if (error instanceof LimitReached) {
      return { ok: false, retryAfterSeconds: error.retryAfterSeconds };
    }
    throw error;
  }
  return { ok: true };
}
