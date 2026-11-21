// Reading institutions (#73).
//
//   getMyInstitution()                          → the one the signed-in user registered
//   listInstitutions({ status? })               → FOA admins' queue, oldest first
//   getInstitutionForReview({ institutionId })  → every detail, for FOA admins

import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { E164Phone } from "../../lib/phone";
import { authorize } from "../access/can";
import { institution, user, type Institution } from "../db/schema";
import { signedInUser } from "../identity/account";
import { invalidInput, type InvalidInput } from "../input";
import type { UseCaseContext } from "../use-cases";
import type { InstitutionType } from "./domain/registration";
import { INSTITUTION_STATUSES, type InstitutionStatus } from "./domain/status";
import { openPrincipalContact } from "./principal-contact";

/** An institution as its authorised person and FOA staff see it. */
export type InstitutionDetails = {
  id: string;
  name: string;
  type: InstitutionType;
  address: string;
  pinCode: string;
  city: string;
  state: string;
  country: string;
  contactEmail: string;
  contactPhone: E164Phone;
  principalName: string;
  principalEmail: string;
  principalPhone: E164Phone;
  expectedParticipants: number;
  status: InstitutionStatus;
  /** Why staff made the latest decision; null while pending. */
  statusReason: string | null;
  /** The Institution ID, from the first verification on. */
  institutionCode: string | null;
  registeredAt: Date;
  verifiedAt: Date | null;
};

/** The row as people read it, with the principal's contact decrypted. */
export function detailsOf(
  ctx: Pick<UseCaseContext, "cipher">,
  row: Institution
): InstitutionDetails {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    pinCode: row.pinCode,
    city: row.city,
    state: row.state,
    country: row.country,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone as E164Phone,
    principalName: row.principalName,
    ...openPrincipalContact(ctx, row),
    expectedParticipants: row.expectedParticipants,
    status: row.status,
    statusReason: row.statusReason,
    institutionCode: row.institutionCode,
    registeredAt: row.createdAt,
    verifiedAt: row.verifiedAt,
  };
}

export type GetMyInstitutionResult =
  | { ok: true; institution: InstitutionDetails }
  | { ok: false; error: "not_found" };

/**
 * The institution the signed-in user registered most recently: after a
 * rejection and a new registration, the new one.
 */
export async function getMyInstitution(
  ctx: UseCaseContext
): Promise<GetMyInstitutionResult> {
  await authorize(ctx, "institution.view-own");
  const { userId } = signedInUser(ctx);
  const [row] = await ctx.db
    .select()
    .from(institution)
    .where(eq(institution.createdBy, userId))
    .orderBy(desc(institution.createdAt), desc(institution.id))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, institution: detailsOf(ctx, row) };
}

/** At most this many institutions per list. */
export const INSTITUTION_LIST_LIMIT = 200;

/** One line of the staff queue. */
export type InstitutionSummary = {
  id: string;
  name: string;
  type: InstitutionType;
  city: string;
  state: string;
  status: InstitutionStatus;
  institutionCode: string | null;
  registeredAt: Date;
};

export type ListInstitutionsInput = { status?: InstitutionStatus };

export type ListInstitutionsResult =
  | { ok: true; institutions: InstitutionSummary[] }
  | InvalidInput;

const listInstitutionsInput = z.object({
  status: z.enum(INSTITUTION_STATUSES).optional(),
});

/** Institutions in one status, or all, oldest registration first. */
export async function listInstitutions(
  ctx: UseCaseContext,
  input: ListInstitutionsInput
): Promise<ListInstitutionsResult> {
  await authorize(ctx, "institution.list");
  const parsed = listInstitutionsInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { status } = parsed.data;

  const institutions = await ctx.db
    .select({
      id: institution.id,
      name: institution.name,
      type: institution.type,
      city: institution.city,
      state: institution.state,
      status: institution.status,
      institutionCode: institution.institutionCode,
      registeredAt: institution.createdAt,
    })
    .from(institution)
    .where(status ? eq(institution.status, status) : undefined)
    .orderBy(asc(institution.createdAt), asc(institution.id))
    .limit(INSTITUTION_LIST_LIMIT);
  return { ok: true, institutions };
}

/** Everything staff need to decide, including who registered it. */
export type InstitutionForReview = InstitutionDetails & {
  authorisedPerson: { id: string; name: string; email: string | null };
};

export type GetInstitutionForReviewResult =
  | { ok: true; institution: InstitutionForReview }
  | InvalidInput
  | { ok: false; error: "not_found" };

const getInstitutionForReviewInput = z.object({ institutionId: z.uuid() });

export async function getInstitutionForReview(
  ctx: UseCaseContext,
  input: { institutionId: string }
): Promise<GetInstitutionForReviewResult> {
  await authorize(ctx, "institution.review");
  const parsed = getInstitutionForReviewInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const [found] = await ctx.db
    .select({
      row: institution,
      person: { id: user.id, name: user.name, email: user.email },
    })
    .from(institution)
    .innerJoin(user, eq(user.id, institution.createdBy))
    .where(eq(institution.id, parsed.data.institutionId));
  if (!found) return { ok: false, error: "not_found" };
  return {
    ok: true,
    institution: {
      ...detailsOf(ctx, found.row),
      authorisedPerson: found.person,
    },
  };
}
