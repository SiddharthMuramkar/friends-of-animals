// getConductCertification({ institutionId, reference }) (#87): the conduct
// page of one institution registration. Whether its conduct is certified,
// by whom (their name; null once their account is gone) and when, under
// which statement version, and whether the actor can certify it now.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import { conductCertification, user } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { institutionResource } from "../../institutions/coordinators/policy";
import { CONDUCT_STATEMENT_VERSION } from "../domain/conduct-statement";
import { loadRegistrationScope } from "../registration-scope";
import { registrationInput } from "./certify-conduct";

export type ConductCertificationView = {
  ok: true;
  reference: string;
  institutionName: string;
  competitionName: string;
  /** The statement version a new certification records. */
  statementVersion: string;
  /** Whether certifyConduct would record a certification now. */
  canCertify: boolean;
  certification: {
    certifiedAt: Date;
    certifiedByName: string | null;
    statementVersion: string;
  } | null;
};

export type GetConductCertificationResult =
  | ConductCertificationView
  | InvalidInput
  | { ok: false; error: "not_found" };

export async function getConductCertification(
  ctx: UseCaseContext,
  input: { institutionId: string; reference: string }
): Promise<GetConductCertificationResult> {
  const parsed = registrationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  await authorize(
    ctx,
    "conduct.read",
    institutionResource(parsed.data.institutionId)
  );
  const scope = await loadRegistrationScope(ctx.db, parsed.data);
  if (!scope) return { ok: false, error: "not_found" };
  const [row] = await ctx.db
    .select({
      certifiedAt: conductCertification.certifiedAt,
      certifiedByName: user.name,
      statementVersion: conductCertification.statementVersion,
    })
    .from(conductCertification)
    .leftJoin(user, eq(user.id, conductCertification.certifiedByUserId))
    .where(eq(conductCertification.institutionRegistrationId, scope.id));
  return {
    ok: true,
    reference: scope.reference,
    institutionName: scope.institutionName,
    competitionName: scope.competition.name,
    statementVersion: CONDUCT_STATEMENT_VERSION,
    canCertify:
      !row &&
      scope.competition.status !== "cancelled" &&
      scope.confirmedStudents > 0,
    certification: row
      ? {
          certifiedAt: row.certifiedAt,
          certifiedByName: row.certifiedByName,
          statementVersion: row.statementVersion,
        }
      : null,
  };
}
