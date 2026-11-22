// registerAsGuardian({ fullName, phone?, adultDeclared }) (#81): a signed-in
// member declares "I am 18 or older and the parent or lawful guardian" and
// gives their name and, if they like, a phone. That makes them an
// unverified guardian: the code that verifies them comes next
// (./verify-guardian.ts), and only a verified guardian adds children.
// While unverified they may declare again, and the latest details stand;
// once verified the record is fixed.
//
// myGuardianProfile() reads the declaration back for the guardian pages.
//
// An account known to be a minor's can't declare itself a guardian: a
// teen whose login is linked to a child's profile, or one who registered
// alone with a date of birth under 18 (./own-profile.ts), whose profile
// is held for the guardian they asked (#81).

import { eq } from "drizzle-orm";
import { z } from "zod";

import { parsePhoneNumber, type E164Phone } from "../../../lib/phone";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { guardian, participantProfile, user } from "../../db/schema";
import { signedInUser } from "../../identity/account";
import { uuidv7 } from "../../ids";
import type { InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { maskIdentifier } from "../institutions/domain/mask-identifier";
import { verifiedEmailOf } from "./account-contact";
import {
  guardianName,
  guardianOfUser,
  guardianPhone,
  storedGuardianDetails,
} from "./guardian-record";
import { ownProfileOf } from "./own-profile";

export type RegisterAsGuardianInput = {
  fullName: string;
  /** An Indian mobile number, typed any usual way; optional. */
  phone?: string | undefined;
  /** "I am 18 or older and the parent or lawful guardian." */
  adultDeclared: boolean;
};

export type RegisterAsGuardianResult =
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error:
        | "adult_declaration_required"
        | "already_verified"
        | "linked_child"
        | "registered_as_minor";
    };

export type MyGuardianProfile =
  | { registered: false }
  | {
      registered: true;
      fullName: string;
      phone: string | null;
      verified: boolean;
      verifiedAt: Date | null;
      /** Where a code goes (masked), or null without a verified email. */
      codeTo: string | null;
    };

const registerInput = z.object({
  fullName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(32).optional(),
  adultDeclared: z.boolean(),
});

/** The fields at fault, or the name and phone (E.164) to store. */
function readDetails(
  input: RegisterAsGuardianInput
):
  | { ok: true; fullName: string; phone: E164Phone | null; declared: boolean }
  | InvalidInput {
  const parsed = registerInput.safeParse(input);
  const fields = new Set<string>(
    parsed.success
      ? []
      : parsed.error.issues.map((issue) => String(issue.path[0]))
  );
  let phone: E164Phone | null = null;
  const typed = typeof input.phone === "string" ? input.phone.trim() : "";
  if (typed) {
    const read = parsePhoneNumber(typed);
    if (read.ok) phone = read.e164;
    else fields.add("phone");
  }
  if (!parsed.success || fields.size > 0) {
    return {
      ok: false,
      error: "invalid_input",
      fields: ["fullName", "phone", "adultDeclared"].filter((field) =>
        fields.has(field)
      ),
    };
  }
  return {
    ok: true,
    fullName: parsed.data.fullName,
    phone,
    declared: parsed.data.adultDeclared,
  };
}

export async function registerAsGuardian(
  ctx: UseCaseContext,
  input: RegisterAsGuardianInput
): Promise<RegisterAsGuardianResult> {
  const { role: actorRole } = await authorize(ctx, "guardian.register");
  const { userId } = signedInUser(ctx);
  const details = readDetails(input);
  if (!details.ok) return details;
  if (!details.declared) {
    return { ok: false, error: "adult_declaration_required" };
  }
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx): Promise<RegisterAsGuardianResult> => {
    // One declaration at a time per user; registering alone takes the
    // same lock, so the own profile read below holds still.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    const [linked] = await tx
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(eq(participantProfile.loginUserId, userId));
    if (linked) return { ok: false, error: "linked_child" };
    if ((await ownProfileOf(tx, ctx, userId, now)) === "minor") {
      return { ok: false, error: "registered_as_minor" };
    }

    const stored = storedGuardianDetails(ctx, details);
    const existing = await guardianOfUser(tx, userId);
    if (existing?.verifiedAt) return { ok: false, error: "already_verified" };
    const guardianId = existing?.id ?? uuidv7(now);
    if (existing) {
      await tx
        .update(guardian)
        .set({ ...stored, adultDeclaredAt: now, updatedAt: now })
        .where(eq(guardian.id, existing.id));
    } else {
      await tx.insert(guardian).values({
        id: guardianId,
        userId,
        ...stored,
        adultDeclaredAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    await recordAudit(tx, ctx, {
      action: "guardian.registered",
      entity: { type: "guardian", id: guardianId },
      before: existing ? { adultDeclaredAt: existing.adultDeclaredAt } : null,
      after: {
        adultDeclaredAt: now,
        phoneGiven: details.phone !== null,
        verified: false,
      },
      actorRole,
    });
    return { ok: true };
  });
}

export async function myGuardianProfile(
  ctx: UseCaseContext
): Promise<MyGuardianProfile> {
  await authorize(ctx, "guardian.register");
  const { userId } = signedInUser(ctx);
  const row = await guardianOfUser(ctx.db, userId);
  if (!row) return { registered: false };
  const email = await verifiedEmailOf(ctx.db, userId);
  return {
    registered: true,
    fullName: guardianName(ctx, row),
    phone: guardianPhone(ctx, row),
    verified: row.verifiedAt !== null,
    verifiedAt: row.verifiedAt,
    codeTo: email === null ? null : maskIdentifier("email", email),
  };
}
