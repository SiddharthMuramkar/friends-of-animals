// Reading institutions (#73).
//
//   getMyInstitution()  → the institution the signed-in user registered

import { desc, eq } from "drizzle-orm";

import type { E164Phone } from "../../lib/phone";
import { authorize } from "../access/can";
import { institution, type Institution } from "../db/schema";
import { signedInUser } from "../identity/account";
import type { UseCaseContext } from "../use-cases";
import type { InstitutionType } from "./domain/registration";
import type { InstitutionStatus } from "./domain/status";
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
