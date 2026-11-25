import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { authorize, can } from "../../access/can";
import {
  club,
  clubDecision,
  clubMembership,
  institution,
  user,
} from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { targetSubject, type TargetInput } from "../community/membership";
import { subjectKeys } from "../community/subjects";
import { readSetting } from "../settings/read";
import { affiliationAt } from "./domain/membership";
import { canSelfAttest, loadAffiliations } from "./affiliations";
import { CLUB_REASON_PURPOSE } from "./decisions";
import { clubIdSchema, type ClubIdInput } from "./membership";
import { userId } from "./shared";

const scope = (id: string) => ({
  scopes: [{ type: "institution" as const, id }],
});
const summary = {
  id: club.id,
  name: club.name,
  institutionId: club.institutionId,
  institutionName: institution.name,
  institutionStatus: institution.status,
  status: club.status,
  appliedAt: club.appliedAt,
  updatedAt: club.updatedAt,
  memberCount: sql<number>`(select count(*)::integer from ${clubMembership} where ${clubMembership.clubId}=${club.id} and ${clubMembership.leftAt} is null)`,
};
function summaries(ctx: UseCaseContext) {
  return ctx.db
    .select(summary)
    .from(club)
    .innerJoin(institution, eq(institution.id, club.institutionId));
}
/** Current user's own affiliation options (including self-attested choices
 * when eligible). The institution names are organisational, not a roster. */
export async function getClubApplicationOptions(ctx: UseCaseContext) {
  await authorize(ctx, "club.apply");
  const id = userId(ctx);
  const affiliation = await loadAffiliations(ctx.db, ctx, id);
  const selfAttest = await canSelfAttest(ctx.db, ctx, id);
  const schools = await ctx.db
    .select({ id: institution.id, name: institution.name })
    .from(institution)
    .where(eq(institution.status, "verified"))
    .orderBy(asc(institution.name), asc(institution.id));
  return {
    enabled: await readSetting(ctx.db, "clubs.enabled"),
    selfAttest,
    institutions: schools.flatMap((school) => {
      const role = affiliationAt(school.id, affiliation);
      return role || selfAttest ? [{ ...school, verifiedRole: role }] : [];
    }),
  };
}
export async function listMyClubs(
  ctx: UseCaseContext,
  input: TargetInput = {}
) {
  const subject = await targetSubject(ctx, input);
  const ids = (await subjectKeys(ctx.db, subject)).flatMap((k) =>
    k.kind === "user" ? [k.userId] : []
  );
  const owned = ids.length ? inArray(club.applicantUserId, ids) : sql`false`;
  const member = ids.length
    ? sql`EXISTS (SELECT 1 FROM ${clubMembership} WHERE ${clubMembership.clubId}=${club.id} AND ${inArray(clubMembership.userId, ids)})`
    : sql`false`;
  const joined = ids.length
    ? sql<boolean>`EXISTS (SELECT 1 FROM ${clubMembership} WHERE ${clubMembership.clubId}=${club.id} AND ${inArray(clubMembership.userId, ids)} AND ${clubMembership.leftAt} IS NULL)`
    : sql<boolean>`false`;
  const myRows = await ctx.db
    .select({
      ...summary,
      joined,
      applicant: sql<boolean>`coalesce(${owned},false)`,
    })
    .from(club)
    .innerJoin(institution, eq(institution.id, club.institutionId))
    .where(or(owned, member))
    .orderBy(desc(club.updatedAt), desc(club.id));
  const options =
    input.childId === undefined ? await getClubApplicationOptions(ctx) : null;
  const verifiedIds = options?.institutions.map((i) => i.id) ?? [];
  const publicRows = verifiedIds.length
    ? await summaries(ctx)
        .where(
          and(
            eq(club.status, "approved"),
            eq(institution.status, "verified"),
            inArray(institution.id, verifiedIds)
          )
        )
        .orderBy(asc(club.name), asc(club.id))
    : [];
  return {
    clubs: myRows,
    available: publicRows.filter(
      (row) => !myRows.some((own) => own.id === row.id)
    ),
    enabled: options?.enabled ?? false,
  };
}
export async function listClubsForReview(ctx: UseCaseContext) {
  await authorize(ctx, "club.review");
  const clubs = await ctx.db
    .select({
      ...summary,
      applicantKind: club.applicantKind,
      applicantVerified: club.applicantVerified,
      applicantName: user.name,
    })
    .from(club)
    .innerJoin(institution, eq(institution.id, club.institutionId))
    .leftJoin(user, eq(user.id, club.applicantUserId))
    .orderBy(desc(club.appliedAt), desc(club.id));
  return { clubs };
}
function parsedId(input: ClubIdInput) {
  const parsed = clubIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("forbidden", "Club not found");
  return parsed.data.clubId;
}
async function getRow(ctx: UseCaseContext, input: ClubIdInput) {
  const id = parsedId(input);
  const [row] = await ctx.db
    .select({
      ...summary,
      applicantUserId: club.applicantUserId,
      applicantKind: club.applicantKind,
      applicantVerified: club.applicantVerified,
    })
    .from(club)
    .innerJoin(institution, eq(institution.id, club.institutionId))
    .where(eq(club.id, id));
  if (!row) throw new DomainError("forbidden", "Club not found");
  return row;
}
async function rosterAccess(ctx: UseCaseContext, input: ClubIdInput) {
  await authorize(ctx, "club.view");
  const row = await getRow(ctx, input);
  if (row.institutionStatus !== "verified") await authorize(ctx, "club.review");
  await authorize(ctx, "club.members.read", scope(row.institutionId));
  return row;
}
export async function getClub(ctx: UseCaseContext, input: ClubIdInput) {
  await authorize(ctx, "club.view");
  const id = userId(ctx);
  const row = await getRow(ctx, input);
  const [membership] = await ctx.db
    .select({ leftAt: clubMembership.leftAt })
    .from(clubMembership)
    .where(
      and(eq(clubMembership.clubId, row.id), eq(clubMembership.userId, id))
    )
    .orderBy(
      sql`${clubMembership.leftAt} is null desc`,
      desc(clubMembership.joinedAt),
      desc(clubMembership.id)
    )
    .limit(1);
  const manager = (await can(ctx, "club.review")).allowed;
  const canReadRoster =
    (await can(ctx, "club.members.read", scope(row.institutionId))).allowed &&
    (manager || row.institutionStatus === "verified");
  const own = row.applicantUserId === id;
  const verifiedRole = affiliationAt(
    row.institutionId,
    await loadAffiliations(ctx.db, ctx, id)
  );
  const selfAttest = await canSelfAttest(ctx.db, ctx, id);
  const eligible =
    row.status === "approved" &&
    row.institutionStatus === "verified" &&
    (verifiedRole || selfAttest);
  if (!manager && !own && !membership && !eligible && !canReadRoster)
    throw new DomainError("forbidden", "Club not found");
  const decisions =
    manager || own
      ? await ctx.db
          .select({
            id: clubDecision.id,
            from: clubDecision.fromStatus,
            to: clubDecision.toStatus,
            at: clubDecision.decidedAt,
            reason: clubDecision.reasonCiphertext,
          })
          .from(clubDecision)
          .where(eq(clubDecision.clubId, row.id))
          .orderBy(desc(clubDecision.decidedAt), desc(clubDecision.id))
      : [];
  const {
    applicantUserId: _applicantUserId,
    applicantKind,
    applicantVerified,
    ...view
  } = row;
  return {
    club: view,
    own,
    joined: membership?.leftAt === null,
    canReadRoster,
    canReview: manager,
    canJoin:
      Boolean(eligible) &&
      membership?.leftAt !== null &&
      (await readSetting(ctx.db, "clubs.enabled")),
    verifiedRole,
    selfAttest,
    applicant:
      manager || own
        ? { kind: applicantKind, verified: applicantVerified }
        : null,
    decisions: decisions.map((d) => ({
      ...d,
      reason: d.reason
        ? ctx.cipher.decrypt(CLUB_REASON_PURPOSE, d.reason)
        : null,
    })),
  };
}
export async function listClubMembers(ctx: UseCaseContext, input: ClubIdInput) {
  const row = await rosterAccess(ctx, input);
  // No contact details, profile identifiers, or private introductions.
  const members = await ctx.db
    .select({
      id: clubMembership.id,
      displayName: user.name,
      role: clubMembership.role,
      affiliationVerified: clubMembership.affiliationVerified,
      joinedAt: clubMembership.joinedAt,
      leftAt: clubMembership.leftAt,
    })
    .from(clubMembership)
    .innerJoin(user, eq(user.id, clubMembership.userId))
    .where(eq(clubMembership.clubId, row.id))
    .orderBy(desc(clubMembership.joinedAt), desc(clubMembership.id));
  return { members };
}
export async function getClubActivity(ctx: UseCaseContext, input: ClubIdInput) {
  const row = await rosterAccess(ctx, input);
  const decisions = await ctx.db
    .select({
      id: clubDecision.id,
      from: clubDecision.fromStatus,
      to: clubDecision.toStatus,
      at: clubDecision.decidedAt,
    })
    .from(clubDecision)
    .where(eq(clubDecision.clubId, row.id));
  const memberships = await ctx.db
    .select({
      id: clubMembership.id,
      joinedAt: clubMembership.joinedAt,
      leftAt: clubMembership.leftAt,
    })
    .from(clubMembership)
    .where(eq(clubMembership.clubId, row.id));
  const activity = [
    { id: row.id, kind: "applied" as const, at: row.appliedAt },
    ...decisions.map((d) => ({
      id: d.id,
      kind:
        d.from === "suspended" && d.to === "approved"
          ? ("reinstated" as const)
          : d.to,
      at: d.at,
    })),
    ...memberships.flatMap((m) => [
      { id: `${m.id}:joined`, kind: "joined" as const, at: m.joinedAt },
      ...(m.leftAt
        ? [{ id: `${m.id}:left`, kind: "left" as const, at: m.leftAt }]
        : []),
    ]),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id))
    .slice(0, 50);
  return { activity };
}
