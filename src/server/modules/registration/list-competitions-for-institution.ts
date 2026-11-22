// listCompetitionsForInstitution({ institutionId }) (#75): the competitions
// a verified institution's people can register it for, with where each one
// stands (open, not open yet, closed) and the institution's reference once
// it has registered. Drafts and competitions for individuals only are
// never listed.

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  competition,
  competitionKeyDate,
  institution,
  institutionRegistration,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import {
  registrationWindow,
  type RegistrationWindow,
} from "./domain/registration-window";

/** A listed competition is published, so never "unpublished". */
export type CompetitionWindow = Exclude<RegistrationWindow, "unpublished">;

export type CompetitionForInstitution = {
  id: string;
  code: string;
  name: string;
  slug: string;
  window: CompetitionWindow;
  opensAt: Date | null;
  closesAt: Date | null;
  /** The institution's registration, once it has one. */
  registration: { reference: string } | null;
};

export type ListCompetitionsForInstitutionResult =
  | {
      ok: true;
      institution: { id: string; name: string };
      competitions: CompetitionForInstitution[];
    }
  | InvalidInput
  | { ok: false; error: "institution_not_verified" };

const listInput = z.object({ institutionId: z.uuid() });

const WINDOW_ORDER: Record<CompetitionWindow, number> = {
  open: 0,
  not_open_yet: 1,
  closed: 2,
};

const time = (at: Date | null, missing: number) => at?.getTime() ?? missing;

/**
 * Open ones first, then those still to open, soonest first; closed ones
 * last, the most recently closed first.
 */
function byWindow(
  a: CompetitionForInstitution,
  b: CompetitionForInstitution
): number {
  const rank = WINDOW_ORDER[a.window] - WINDOW_ORDER[b.window];
  if (rank !== 0) return rank;
  const when =
    a.window === "closed"
      ? time(b.closesAt, 0) - time(a.closesAt, 0)
      : time(a.opensAt, Infinity) - time(b.opensAt, Infinity);
  return when || a.name.localeCompare(b.name, "en-IN");
}

export async function listCompetitionsForInstitution(
  ctx: UseCaseContext,
  input: { institutionId: string }
): Promise<ListCompetitionsForInstitutionResult> {
  await authorize(
    ctx,
    "institution.coordinate",
    institutionResource(input.institutionId)
  );
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId } = parsed.data;

  const [owner] = await ctx.db
    .select({ name: institution.name, status: institution.status })
    .from(institution)
    .where(eq(institution.id, institutionId));
  // Its people keep their roles while it is suspended (#73, #74), but
  // they can't register it for anything until FOA reinstates it.
  if (owner?.status !== "verified") {
    return { ok: false, error: "institution_not_verified" };
  }

  const rows = await ctx.db
    .select({
      id: competition.id,
      code: competition.code,
      name: competition.name,
      slug: competition.slug,
      status: competition.status,
    })
    .from(competition)
    .where(
      and(
        ne(competition.status, "draft"),
        inArray(competition.participation, ["institutions", "both"])
      )
    );
  const ids = rows.map((row) => row.id);
  const [dates, registrations] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          ctx.db
            .select()
            .from(competitionKeyDate)
            .where(
              and(
                inArray(competitionKeyDate.competitionId, ids),
                inArray(competitionKeyDate.kind, [
                  "registration_opens",
                  "registration_closes",
                ])
              )
            ),
          ctx.db
            .select({
              competitionId: institutionRegistration.competitionId,
              reference: institutionRegistration.reference,
            })
            .from(institutionRegistration)
            .where(
              and(
                eq(institutionRegistration.institutionId, institutionId),
                inArray(institutionRegistration.competitionId, ids)
              )
            ),
        ]);

  const dateOf = (competitionId: string, kind: string) =>
    dates.find((d) => d.competitionId === competitionId && d.kind === kind)
      ?.at ?? null;
  const now = ctx.clock.now();
  const competitions = rows.flatMap((row): CompetitionForInstitution[] => {
    const opensAt = dateOf(row.id, "registration_opens");
    const closesAt = dateOf(row.id, "registration_closes");
    const window = registrationWindow(
      { status: row.status, registrationClosesAt: closesAt },
      now
    );
    if (window === "unpublished") return [];
    const registered = registrations.find((r) => r.competitionId === row.id);
    return [
      {
        id: row.id,
        code: row.code,
        name: row.name,
        slug: row.slug,
        window,
        opensAt,
        closesAt,
        registration: registered ? { reference: registered.reference } : null,
      },
    ];
  });

  return {
    ok: true,
    institution: { id: institutionId, name: owner.name },
    competitions: competitions.sort(byWindow),
  };
}
