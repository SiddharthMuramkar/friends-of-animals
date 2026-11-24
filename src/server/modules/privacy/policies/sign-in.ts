// Retention for signing in (#57, #58): sign-in codes and links once they
// have expired, and sessions (with the network address and browser they
// recorded) 30 days after they expired.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  guardian,
  legalHold,
  session,
  user,
  verification,
} from "../../../db/schema";
import { phoneVerificationIdentifier } from "../../../identity/phone-code";
import { guardianVerificationIdentifier } from "../../guardians/verification-code";
import { rowPolicy } from "./define";
import type { RetentionPolicy } from "./types";

const verificationRows = rowPolicy({
  key: "expiredVerifications",
  table: verification,
  action: "delete",
  period: "expiredVerifications",
  anchor: verification.expiresAt,
  orderByAnchor: true,
});

export const EXPIRED_VERIFICATIONS: RetentionPolicy = {
  ...verificationRows,
  async candidates(db, query) {
    const page = await verificationRows.candidates(db, query);
    if (page.candidates.length === 0) return page;

    // Only held accounts can affect this plan. Rebuild their identifiers
    // under the hold lock without scanning every account or storing emails.
    const heldAccounts = await db
      .select({
        id: user.id,
        email: user.email,
        phoneHash: user.phoneHash,
        guardianId: guardian.id,
      })
      .from(legalHold)
      .innerJoin(user, eq(user.id, legalHold.subjectId))
      .leftJoin(guardian, eq(guardian.userId, user.id))
      .where(
        and(eq(legalHold.subjectType, "user"), isNull(legalHold.releasedAt))
      );
    if (heldAccounts.length === 0) return page;

    const owners = new Map<string, string>();
    for (const { id, email, phoneHash, guardianId } of heldAccounts) {
      if (email !== null) {
        // Better Auth stores SHA-256 as unpadded base64url. Its adapter
        // also looks up legacy plain identifiers.
        const identifier = `sign-in-otp-${email}`;
        owners.set(
          createHash("sha256").update(identifier).digest("base64url"),
          id
        );
        owners.set(identifier, id);
      }
      if (phoneHash !== null)
        owners.set(phoneVerificationIdentifier(phoneHash), id);
      if (guardianId !== null)
        owners.set(guardianVerificationIdentifier(guardianId), id);
    }
    const records = await db
      .select({ id: verification.id, identifier: verification.identifier })
      .from(verification)
      .where(
        inArray(
          verification.id,
          page.candidates.map(({ id }) => id)
        )
      );
    const subjectByRecord = new Map(
      records.map(({ id, identifier }) => [id, owners.get(identifier)])
    );
    return {
      ...page,
      candidates: page.candidates.map((candidate) => {
        const id = subjectByRecord.get(candidate.id);
        return id
          ? { ...candidate, subjects: [{ type: "user", id }] }
          : candidate;
      }),
    };
  },
};

export const EXPIRED_SESSIONS = rowPolicy({
  key: "expiredSessions",
  table: session,
  action: "delete",
  period: "expiredSessions",
  anchor: session.expiresAt,
  orderByAnchor: true,
  subjects: [["user", session.userId]],
});
