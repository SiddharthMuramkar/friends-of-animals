// Reading volunteer applications (#123).
//
//   myVolunteerApplication()                    → the signed-in member's own
//   childVolunteerApplication({ childId })      → the child's verified guardian
//   listVolunteerApplications({ status? })      → community managers
//   getVolunteerApplication({ applicationId })  → community managers
//
// Loads under plain Node: relative imports only.

import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { authorize } from "../../access/can";
import { grantsOf } from "../../access/grants";
import type { AppDb } from "../../db/app-db";
import {
  participantProfile,
  user,
  volunteerApplication,
  type VolunteerApplication,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import type { PublishedConsentDocument } from "../consent/documents";
import { latestDocument } from "../consent/repository";
import { childResource } from "../guardians/child-access";
import { ageAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import {
  applicantProfileOf,
  DATE_OF_BIRTH_PURPOSE,
  DECLINE_REASON_PURPOSE,
  latestApplicationOf,
} from "./application-record";
import type { Availability, VolunteerInterest } from "./domain/application-input";
import {
  VOLUNTEER_APPLICATION_STATUSES,
  type VolunteerApplicationStatus,
} from "./domain/application-status";
import {
  DECLARATION_PURPOSES,
  declarationStates,
  standingOf,
  type DeclarationKey,
  type DeclarationStanding,
} from "./declarations";

/** An application as its applicant, or their guardian, sees it. */
export type VolunteerApplicationView = {
  id: string;
  status: VolunteerApplicationStatus;
  interests: VolunteerInterest[];
  availability: Availability;
  createdAt: Date;
  closedAt: Date | null;
  /** Told to the applicant when a community manager declines. */
  declineReason: string | null;
  /** How each declaration stands now. */
  declarations: Record<DeclarationKey, DeclarationStanding>;
};

export type MyVolunteerApplication = {
  /** Whether FOA takes applications now (setting volunteers.applicationsOpen). */
  applicationsOpen: boolean;
  /** Holds the volunteer role already. */
  isVolunteer: boolean;
  /**
   * Whether the form asks for a date of birth: false when a participant
   * profile holds it.
   */
  asksDateOfBirth: boolean;
  /** Each declaration's current version, or null before staff publish one. */
  documents: Record<DeclarationKey, PublishedConsentDocument | null>;
  /** The newest application, or null before the first. */
  application: VolunteerApplicationView | null;
};

async function currentDocuments(
  db: AppDb
): Promise<Record<DeclarationKey, PublishedConsentDocument | null>> {
  const [safeguarding, conduct] = await Promise.all([
    latestDocument(db, DECLARATION_PURPOSES.safeguarding),
    latestDocument(db, DECLARATION_PURPOSES.conduct),
  ]);
  return { safeguarding, conduct };
}

async function viewOf(
  ctx: Pick<UseCaseContext, "db" | "cipher">,
  row: VolunteerApplication
): Promise<VolunteerApplicationView> {
  const states = await declarationStates(ctx.db, row.applicantUserId);
  return {
    id: row.id,
    status: row.status,
    interests: row.interests,
    availability: row.availability,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    declineReason:
      row.declineReasonCiphertext === null
        ? null
        : ctx.cipher.decrypt(DECLINE_REASON_PURPOSE, row.declineReasonCiphertext),
    declarations: {
      safeguarding: standingOf(states.safeguarding),
      conduct: standingOf(states.conduct),
    },
  };
}

function signedInUser(ctx: UseCaseContext): string {
  if (ctx.actor.kind !== "user") throw new Error("Needs a signed-in user");
  return ctx.actor.userId;
}

/** The signed-in member's newest application, and what applying needs. */
export async function myVolunteerApplication(
  ctx: UseCaseContext
): Promise<MyVolunteerApplication> {
  await authorize(ctx, "volunteer.view_own");
  const userId = signedInUser(ctx);
  const [open, grants, profile, documents, latest] = await Promise.all([
    ctx.settings.get("volunteers.applicationsOpen"),
    grantsOf(ctx.db, userId),
    applicantProfileOf(ctx.db, ctx.cipher, userId),
    currentDocuments(ctx.db),
    latestApplicationOf(ctx.db, userId),
  ]);
  return {
    applicationsOpen: open,
    isVolunteer: grants.some(
      (grant) => grant.role === "volunteer" && grant.scope.type === "global"
    ),
    asksDateOfBirth: profile === null,
    documents,
    application: latest ? await viewOf(ctx, latest) : null,
  };
}

export type ChildVolunteerApplicationResult =
  | {
      ok: true;
      child: { id: string; fullName: string };
      /** The child's newest application, or null if they never applied. */
      application: VolunteerApplicationView | null;
    }
  | InvalidInput;

const childInput = z.object({ childId: z.uuid() });

/** A child's newest application, for their verified guardian. */
export async function childVolunteerApplication(
  ctx: UseCaseContext,
  input: { childId: string }
): Promise<ChildVolunteerApplicationResult> {
  await authorize(
    ctx,
    "volunteer.child.view",
    await childResource(ctx.db, ctx.actor, input.childId)
  );
  const parsed = childInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { childId } = parsed.data;
  const [child] = await ctx.db
    .select({ id: participantProfile.id, fullName: participantProfile.fullName })
    .from(participantProfile)
    .where(eq(participantProfile.id, childId));
  if (!child) throw new Error("A linked child's profile is missing");
  const [row] = await ctx.db
    .select()
    .from(volunteerApplication)
    .where(eq(volunteerApplication.participantProfileId, childId))
    .orderBy(desc(volunteerApplication.createdAt), desc(volunteerApplication.id))
    .limit(1);
  return {
    ok: true,
    child,
    application: row ? await viewOf(ctx, row) : null,
  };
}

/** One application in the community team's queue. */
export type VolunteerApplicationSummary = {
  id: string;
  status: VolunteerApplicationStatus;
  applicant: { id: string; name: string };
  /** Completed years today, from the date of birth applied with. */
  ageYears: number;
  interests: VolunteerInterest[];
  createdAt: Date;
};

export type ListVolunteerApplicationsResult =
  | { ok: true; items: VolunteerApplicationSummary[] }
  | InvalidInput;

const listInput = z.object({
  status: z.enum(VOLUNTEER_APPLICATION_STATUSES).optional(),
});

function ageNow(
  ctx: Pick<UseCaseContext, "cipher" | "clock">,
  ciphertext: string
): number {
  const date = parseIsoDate(ctx.cipher.decrypt(DATE_OF_BIRTH_PURPOSE, ciphertext));
  if (!date) throw new Error("A stored date of birth is not a date");
  return ageAt(date, ctx.clock.now());
}

/**
 * The applications in one status (by default those waiting for a
 * community manager), oldest first, so the longest waiting comes first.
 */
export async function listVolunteerApplications(
  ctx: UseCaseContext,
  input: { status?: string } = {}
): Promise<ListVolunteerApplicationsResult> {
  await authorize(ctx, "volunteer.review");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const status = parsed.data.status ?? "submitted";
  const rows = await ctx.db
    .select({
      id: volunteerApplication.id,
      status: volunteerApplication.status,
      applicantId: user.id,
      applicantName: user.name,
      dob: volunteerApplication.dateOfBirthCiphertext,
      interests: volunteerApplication.interests,
      createdAt: volunteerApplication.createdAt,
    })
    .from(volunteerApplication)
    .innerJoin(user, eq(user.id, volunteerApplication.applicantUserId))
    .where(eq(volunteerApplication.status, status))
    .orderBy(asc(volunteerApplication.createdAt), asc(volunteerApplication.id));
  return {
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      applicant: { id: row.applicantId, name: row.applicantName },
      ageYears: ageNow(ctx, row.dob),
      interests: row.interests,
      createdAt: row.createdAt,
    })),
  };
}

/** One application as a community manager reviews it. */
export type VolunteerApplicationDetail = VolunteerApplicationView & {
  applicant: { id: string; name: string; email: string | null };
  ageYears: number;
  /** A teen applied on the profile their guardian keeps. */
  minor: boolean;
  guardian: { name: string; decidedAt: Date } | null;
  decidedBy: { name: string } | null;
  decidedAt: Date | null;
};

export type GetVolunteerApplicationResult =
  | { ok: true; application: VolunteerApplicationDetail }
  | InvalidInput
  | { ok: false; error: "not_found" };

const getInput = z.object({ applicationId: z.uuid() });

const guardianUser = alias(user, "guardian_user");
const deciderUser = alias(user, "decider_user");

export async function getVolunteerApplication(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<GetVolunteerApplicationResult> {
  await authorize(ctx, "volunteer.review");
  const parsed = getInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [found] = await ctx.db
    .select({
      row: volunteerApplication,
      applicant: { id: user.id, name: user.name, email: user.email },
      ownerKind: participantProfile.ownerKind,
      guardianName: guardianUser.name,
      deciderName: deciderUser.name,
    })
    .from(volunteerApplication)
    .innerJoin(user, eq(user.id, volunteerApplication.applicantUserId))
    .leftJoin(
      participantProfile,
      eq(participantProfile.id, volunteerApplication.participantProfileId)
    )
    .leftJoin(
      guardianUser,
      eq(guardianUser.id, volunteerApplication.guardianUserId)
    )
    .leftJoin(
      deciderUser,
      eq(deciderUser.id, volunteerApplication.decidedByUserId)
    )
    .where(eq(volunteerApplication.id, parsed.data.applicationId));
  if (!found) return { ok: false, error: "not_found" };
  const { row } = found;
  return {
    ok: true,
    application: {
      ...(await viewOf(ctx, row)),
      applicant: found.applicant,
      ageYears: ageNow(ctx, row.dateOfBirthCiphertext),
      minor: found.ownerKind === "guardian",
      guardian:
        row.guardianDecidedAt && found.guardianName !== null
          ? { name: found.guardianName, decidedAt: row.guardianDecidedAt }
          : null,
      decidedBy: found.deciderName === null ? null : { name: found.deciderName },
      decidedAt: row.decidedAt,
    },
  };
}
