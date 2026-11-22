// How a guardian sees their children (#81): each child's age today on
// India's calendar, the kind of profile that age gives (managed under 13,
// linked from 13 to 17, adult from 18), and where their own login stands.
// Read fresh each time, so a child who has had a birthday shows their new
// age and kind.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray } from "drizzle-orm";

import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { guardianInvitation, participantProfile } from "../../db/schema";
import { maskIdentifier } from "../institutions/domain/mask-identifier";
import { invitationStatus } from "../institutions/domain/invitation";
import { ageAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import type { GuardianRelationship } from "../registration/domain/student-details";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { childKindForAge, type ChildKind } from "./domain/children";
import { readTeenContact } from "./teen-contact";

export type ChildLogin = "none" | "invited" | "linked";

export type ChildSummary = {
  id: string;
  fullName: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string;
  /** Completed years today, in India. */
  age: number;
  kind: ChildKind | "adult";
  login: ChildLogin;
  relationship: GuardianRelationship;
};

/** The teen-login invitation still waiting for a child, if any. */
export type PendingTeenInvitation = {
  /** `t***@example.test`: enough to recognise, no more. */
  sentTo: string;
  expiresAt: Date;
  status: "pending" | "expired";
};

export type ChildDetail = ChildSummary & {
  invitation: PendingTeenInvitation | null;
};

type ChildRow = {
  id: string;
  fullName: string;
  dobCiphertext: string;
  loginUserId: string | null;
  relationship: GuardianRelationship;
};

/** The columns a child's view is read from, profile and link joined. */
export const CHILD_COLUMNS = {
  id: participantProfile.id,
  fullName: participantProfile.fullName,
  dobCiphertext: participantProfile.dobCiphertext,
  loginUserId: participantProfile.loginUserId,
} as const;

/** The pending teen-login invitations of these children, by child id. */
async function pendingInvitations(
  db: AppDb,
  cipher: FieldCipher,
  childIds: readonly string[],
  now: Date
): Promise<Map<string, PendingTeenInvitation>> {
  if (childIds.length === 0) return new Map();
  const rows = await db
    .select({
      childId: guardianInvitation.participantProfileId,
      channel: guardianInvitation.channel,
      contactCiphertext: guardianInvitation.contactCiphertext,
      status: guardianInvitation.status,
      expiresAt: guardianInvitation.expiresAt,
    })
    .from(guardianInvitation)
    .where(
      and(
        inArray(guardianInvitation.participantProfileId, [...childIds]),
        eq(guardianInvitation.kind, "teen_login"),
        eq(guardianInvitation.status, "pending")
      )
    );
  return new Map(
    rows.map((row) => {
      const contact = readTeenContact({ cipher }, row);
      const status = invitationStatus(row, now);
      return [
        row.childId,
        {
          sentTo: maskIdentifier(contact.channel, contact.address),
          expiresAt: row.expiresAt,
          status: status === "expired" ? "expired" : "pending",
        },
      ];
    })
  );
}

/** The date of birth of a child's profile, read back. */
export function childDateOfBirth(
  { cipher }: { cipher: FieldCipher },
  row: { dobCiphertext: string }
) {
  const text = cipher.decrypt(PROFILE_PURPOSE.dob, row.dobCiphertext);
  const date = parseIsoDate(text);
  if (!date) throw new Error("A child's stored date of birth isn't a date");
  return { text, date };
}

/** Each child as their guardian sees them at `now`, in the given order. */
export async function viewChildren(
  deps: { db: AppDb; cipher: FieldCipher },
  rows: readonly ChildRow[],
  now: Date
): Promise<ChildDetail[]> {
  const invitations = await pendingInvitations(
    deps.db,
    deps.cipher,
    rows.filter((row) => row.loginUserId === null).map((row) => row.id),
    now
  );
  return rows.map((row) => {
    const dob = childDateOfBirth(deps, row);
    const age = ageAt(dob.date, now);
    const invitation = invitations.get(row.id) ?? null;
    return {
      id: row.id,
      fullName: row.fullName,
      dateOfBirth: dob.text,
      age,
      kind: childKindForAge(age),
      login:
        row.loginUserId !== null
          ? "linked"
          : invitation?.status === "pending"
            ? "invited"
            : "none",
      relationship: row.relationship,
      invitation,
    };
  });
}
