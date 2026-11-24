// Shared set-up for the volunteers module's Seam 1 tests: applications
// open with both declarations published, an application as a member would
// send it, a teen whose own login is linked to a verified guardian, staff
// who passed their second factor, and readers for the rows a compliance
// rule cares about. Test code only; nothing in the app imports it.

import { and, asc, eq, like } from "drizzle-orm";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import {
  auditLog,
  consentEvent,
  outbox,
  participantProfile,
  volunteerApplication,
} from "@/server/db/schema";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import type { VolunteerPurpose } from "@/server/modules/consent/domain/purposes";
import { formatIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "@/server/modules/registration/student-profile";
import { bornYearsAgo as birthDateYearsAgo } from "@/server/seed/guardians";
import type { Harness } from "@/test/harness";

import type { ApplyToVolunteerInput } from "./apply";

/** What the set-up needs: the harness, or a real-Postgres world's deps. */
type World = Pick<Harness, "db" | "clock" | "settings">;

/** Publishes the next version of a declaration straight into the table. */
export async function publishDeclaration(
  h: Pick<World, "db" | "clock">,
  purpose: VolunteerPurpose
): Promise<string> {
  const parsed = parseConsentDocumentBody({
    short: [[`Draft ${purpose}.`]],
    sections: [
      {
        id: "what-you-declare",
        title: "What you declare",
        blocks: [{ p: [`Draft ${purpose} text. Not FOA's words.`] }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  const { id } = await h.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: h.clock.now(), publishedByUserId: null },
      { purpose, title: null, body: parsed.body, legalRevisionId: null }
    )
  );
  return id;
}

export type Declarations = { safeguarding: string; conduct: string };

/** Applications open, and version 1 of both declarations published. */
export async function openVolunteering(h: World): Promise<Declarations> {
  await h.settings.set("volunteers.applicationsOpen", true);
  return {
    safeguarding: await publishDeclaration(
      h,
      "volunteer_safeguarding_declaration"
    ),
    conduct: await publishDeclaration(h, "volunteer_code_of_conduct"),
  };
}

/** `YYYY-MM-DD` of someone `years` old today in India, `days` past it. */
export function bornYearsAgo(
  h: Pick<World, "clock">,
  years: number,
  days = 0
): string {
  return formatIsoDate(birthDateYearsAgo(h.clock.now(), years, days));
}

/** What a member sends when they apply, accepting both declarations. */
export function applicationInput(
  declarations: Declarations,
  overrides: Partial<ApplyToVolunteerInput> = {}
): ApplyToVolunteerInput {
  return {
    interests: ["outreach", "technology"],
    availability: {
      slots: [
        { day: "saturday", part: "morning" },
        { day: "wednesday", part: "evening" },
      ],
      note: "School holidays too",
    },
    safeguardingDocumentId: declarations.safeguarding,
    conductDocumentId: declarations.conduct,
    ...overrides,
  };
}

/** A signed-in member with no participant profile. */
export async function member(
  h: Harness,
  details: { name: string; email: string }
): Promise<{ id: string; actor: Actor }> {
  const account = await h.seed.member(details);
  return { id: account.id, actor: await h.signIn(account) };
}

/** An adult with no profile who applies, typing their date of birth. */
export async function adultApplication(
  h: Harness,
  declarations: Declarations,
  details = { name: "Priya Nair", email: "priya@example.test" }
) {
  const applicant = await member(h, details);
  const result = await h.as(applicant.actor).applyToVolunteer(
    applicationInput(declarations, { dateOfBirth: bornYearsAgo(h, 30) })
  );
  if (!result.ok) throw new Error(`Applying failed: ${result.error}`);
  return { ...applicant, applicationId: result.applicationId };
}

/**
 * A teen of `age` (and `days` past their birthday) whose own login is
 * linked to the guardian-kept profile of a verified guardian, both signed
 * in.
 */
export async function linkedTeen(
  h: Harness,
  { age = 15, days }: { age?: number; days?: number } = {}
) {
  const teen = await h.seed.member({
    name: "Arjun Rao",
    email: "arjun@example.test",
  });
  const family = await h.seed.guardian({
    name: "Sunita Rao",
    email: "sunita@example.test",
    children: [{ fullName: "Arjun Rao", age, loginUserId: teen.id }],
  });
  const profileId = family.childIds[0]!;
  if (days !== undefined) {
    await h.db
      .update(participantProfile)
      .set({
        dobCiphertext: h.deps.cipher.encrypt(
          PROFILE_PURPOSE.dob,
          bornYearsAgo(h, age, days)
        ),
      })
      .where(eq(participantProfile.id, profileId));
  }
  return {
    teen: { id: teen.id, actor: await h.signIn(teen) },
    guardian: {
      id: family.account.id,
      actor: await h.signIn(family.account),
    },
    profileId,
  };
}

/** A teen's application, waiting for their guardian. */
export async function teenApplication(
  h: Harness,
  declarations: Declarations,
  options: Parameters<typeof linkedTeen>[1] = {}
) {
  const family = await linkedTeen(h, options);
  const result = await h
    .as(family.teen.actor)
    .applyToVolunteer(applicationInput(declarations));
  if (!result.ok) throw new Error(`Applying failed: ${result.error}`);
  return { ...family, applicationId: result.applicationId };
}

/** A signed-in user holding `role` globally, second factor passed. */
export async function staffActor(h: Harness, role: Role): Promise<Actor> {
  const account = await h.seed.member();
  await h.seed.grant(account, { role, scope: { type: "global" } });
  return h.signIn(account);
}

/** The user id of a signed-in actor. */
export function userIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("Not a signed-in user");
  return actor.userId;
}

export async function applicationRow(h: Harness, id: string) {
  const [row] = await h.db
    .select()
    .from(volunteerApplication)
    .where(eq(volunteerApplication.id, id));
  return row;
}

export async function applicationRows(h: Harness) {
  return h.db
    .select()
    .from(volunteerApplication)
    .orderBy(asc(volunteerApplication.createdAt));
}

/** The volunteer audit entries, in the order they were written. */
export async function volunteerAudit(h: Harness) {
  // Audit ids are monotonic, so they keep the order of one millisecond.
  return h.db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, "volunteer.%"))
    .orderBy(asc(auditLog.id));
}

/**
 * The volunteer events queued in the outbox, by when they happened, then
 * by type: outbox ids order one millisecond at random.
 */
export async function volunteerEvents(h: Harness) {
  return h.db
    .select({ type: outbox.eventType, payload: outbox.payload })
    .from(outbox)
    .where(like(outbox.eventType, "volunteer.%"))
    .orderBy(asc(outbox.occurredAt), asc(outbox.eventType));
}

/** A user's consent events for one declaration, oldest first. */
export async function declarationEvents(
  h: Harness,
  userId: string,
  purpose: VolunteerPurpose
) {
  return h.db
    .select()
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.subjectType, "user"),
        eq(consentEvent.subjectId, userId),
        eq(consentEvent.purpose, purpose)
      )
    )
    .orderBy(asc(consentEvent.id));
}
