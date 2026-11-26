import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { authorize, can } from "../../access/can";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import {
  artworkCustodyEvent,
  competition,
  entry,
  institutionRegistration,
  physicalArtwork,
  registration,
  type PhysicalArtworkRow,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { withUniqueCode } from "../codes/codes";
import { institutionResource } from "../institutions/coordinators/policy";
import { visibleProfiles } from "../participants/list-my-registrations";
import { artworkCodeFormat, normaliseArtworkCode } from "./domain/code";
import { decideArtwork, decideArtworkRequest } from "./domain/decide";
import { PHYSICAL_ARTWORK_STATUSES } from "./domain/status";
import { custodyUseCases, returnSummary, nextCustodyId } from "./custody";

const ids = z
  .array(z.uuid())
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length);
const requestInput = z.object({
  competitionId: z.uuid(),
  entryIds: ids,
  packagingInstructions: z.string().trim().min(1).max(2000).optional(),
  shippingPayer: z.enum(["foa", "sender"]).optional(),
});
const compResource = (id: string) => ({
  scopes: [{ type: "competition" as const, id }],
});
const ordered = [
  asc(physicalArtwork.status),
  asc(physicalArtwork.dispatchDeadline),
  asc(physicalArtwork.artworkCode),
];
const SAMPLE_ADDRESS =
  "FOA Demonstration Facility, Sample Road, Mumbai (preview only)";

async function requestSettings(ctx: UseCaseContext) {
  const [
    dispatchDays,
    reminderLeadHours,
    packagingInstructions,
    foaPays,
    address,
  ] = await Promise.all([
    ctx.settings.get("artwork.dispatchDays"),
    ctx.settings.get("artwork.dispatchReminderLeadHours"),
    ctx.settings.get("artwork.packagingInstructions"),
    ctx.settings.get("artwork.shippingPayer"),
    ctx.settings.get("org.foaFacilityAddress"),
  ]);
  return {
    dispatchDays,
    reminderLeadHours,
    packagingInstructions,
    shippingPayer: foaPays ? ("foa" as const) : ("sender" as const),
    facilityAddress:
      address || (ctx.appEnv === "production" ? "" : SAMPLE_ADDRESS),
  };
}

async function requestPhysicalArtwork(
  ctx: UseCaseContext,
  input: z.input<typeof requestInput>
) {
  const { role } = await authorize(
    ctx,
    "artwork.request",
    compResource(input.competitionId)
  );
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, entryIds } = parsed.data;
  const settings = await requestSettings(ctx);
  const actor = ctx.actor;
  if (actor.kind !== "user") throw new Error("unreachable");
  return ctx.db.transaction(async (tx) => {
    // Serialize requests in one competition, including its top-N limit.
    const [comp] = await tx
      .select()
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("update");
    if (!comp) return { ok: false, error: "not_found" } as const;
    if (comp.status === "cancelled")
      return { ok: false, error: "physical_not_required" } as const;
    const rows = await tx
      .select({ entry, registration })
      .from(entry)
      .innerJoin(registration, eq(entry.registrationId, registration.id))
      .where(
        and(inArray(entry.id, entryIds), eq(entry.competitionId, competitionId))
      )
      .orderBy(asc(entry.id))
      .for("update", { of: [entry, registration] });
    if (rows.length !== entryIds.length)
      return { ok: false, error: "not_found" } as const;
    const existing = await tx
      .select({ entryId: physicalArtwork.entryId })
      .from(physicalArtwork)
      .where(eq(physicalArtwork.competitionId, competitionId));
    const already = new Set(existing.map((row) => row.entryId));
    const now = ctx.clock.now();
    const plans = [];
    for (const row of rows) {
      const decision = decideArtworkRequest(
        {
          entryStatus: row.entry.status,
          physicalArtworkRequired: comp.physicalArtwork !== "not_required",
          alreadyRequested: already.has(row.entry.id),
        },
        settings,
        now
      );
      if (!decision.ok)
        return {
          ok: false,
          error: decision.code,
          entryId: row.entry.id,
        } as const;
      if (row.registration.status !== "confirmed")
        return {
          ok: false,
          error: "entry_not_verified",
          entryId: row.entry.id,
        } as const;
      plans.push({ row, decision });
    }
    if (
      comp.physicalArtwork === "top_n" &&
      existing.length + rows.length > (comp.physicalArtworkTopN ?? 0)
    )
      return { ok: false, error: "top_n_exceeded" } as const;
    if (
      !settings.facilityAddress ||
      (ctx.appEnv === "production" &&
        settings.facilityAddress === SAMPLE_ADDRESS)
    )
      return { ok: false, error: "facility_address_not_configured" } as const;
    const artworks = [];
    for (const { row, decision } of plans) {
      const id = uuidv7(now);
      const artworkCode = await withUniqueCode(
        {
          format: artworkCodeFormat(comp.code),
          constraint: "physical_artwork_artwork_code_key",
        },
        (code) =>
          tx.transaction(async (savepoint) => {
            await savepoint.insert(physicalArtwork).values({
              id,
              entryId: row.entry.id,
              competitionId,
              artworkCode: code,
              status: "requested",
              registrationId: row.registration.id,
              institutionRegistrationId:
                row.registration.institutionRegistrationId,
              requestedBy: actor.userId,
              requestedAt: now,
              dispatchDeadline: decision.dispatchDeadline,
              packagingInstructions:
                parsed.data.packagingInstructions ??
                settings.packagingInstructions,
              shippingPayer:
                parsed.data.shippingPayer ?? settings.shippingPayer,
              facilityAddress: settings.facilityAddress,
            });
            return code;
          })
      );
      await recordAudit(tx, ctx, {
        action: "physical_artwork.requested",
        entity: { type: "physical_artwork", id },
        before: null,
        after: { status: "requested", entryId: row.entry.id, artworkCode },
        actorRole: role,
      });
      await emit(tx, ctx.clock, {
        type: "artwork.requested",
        aggregate: { type: "physical_artwork", id },
        payload: { artworkId: id },
      });
      artworks.push({
        artworkId: id,
        artworkCode,
        entryId: row.entry.id,
        dispatchDeadline: decision.dispatchDeadline,
      });
    }
    return { ok: true, artworks } as const;
  });
}

function view(
  row: PhysicalArtworkRow,
  now: Date,
  entryCode: string,
  entryTitle: string
) {
  return {
    artworkId: row.id,
    artworkCode: row.artworkCode,
    entryCode,
    entryTitle,
    entryId: row.entryId,
    competitionId: row.competitionId,
    registrationId: row.registrationId,
    institutionRegistrationId: row.institutionRegistrationId,
    status: row.status,
    requestedAt: row.requestedAt,
    dispatchDeadline: row.dispatchDeadline,
    packagingInstructions: row.packagingInstructions,
    shippingPayer: row.shippingPayer,
    facilityAddress: row.facilityAddress,
    courierName: row.courierName,
    trackingNumber: row.trackingNumber,
    dispatchedAt: row.dispatchedAt,
    receivedAt: row.receivedAt,
    overdue: row.status === "requested" && now > row.dispatchDeadline,
    dispatchedLate:
      row.dispatchedAt !== null && row.dispatchedAt > row.dispatchDeadline,
    receivedWithoutDispatch:
      row.receivedAt !== null && row.dispatchedAt === null,
  };
}
export type ArtworkView = ReturnType<typeof view>;

const listInput = z.object({
  competitionId: z.uuid(),
  status: z.enum(PHYSICAL_ARTWORK_STATUSES).optional(),
  query: z.string().trim().max(60).optional(),
});
async function listArtworks(
  ctx: UseCaseContext,
  input: z.input<typeof listInput>
) {
  await authorize(ctx, "artwork.read", compResource(input.competitionId));
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, status, query } = parsed.data;
  const rows = await ctx.db
    .select({
      work: physicalArtwork,
      entryCode: entry.code,
      entryTitle: entry.title,
    })
    .from(physicalArtwork)
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .where(
      and(
        eq(physicalArtwork.competitionId, competitionId),
        status ? eq(physicalArtwork.status, status) : undefined,
        query
          ? or(
              eq(
                physicalArtwork.artworkCode,
                normaliseArtworkCode(query) ?? ""
              ),
              eq(
                physicalArtwork.trackingNumber,
                query.replace(/\s+/g, "").toUpperCase()
              )
            )
          : undefined
      )
    )
    .orderBy(...ordered);
  return {
    ok: true,
    artworks: rows.map((row) =>
      view(row.work, ctx.clock.now(), row.entryCode, row.entryTitle)
    ),
  } as const;
}
async function getArtwork(ctx: UseCaseContext, input: { artworkCode: string }) {
  const [row] = await ctx.db
    .select({
      work: physicalArtwork,
      entryCode: entry.code,
      entryTitle: entry.title,
    })
    .from(physicalArtwork)
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .where(
      eq(
        physicalArtwork.artworkCode,
        normaliseArtworkCode(input.artworkCode) ?? ""
      )
    );
  await authorize(
    ctx,
    "artwork.read",
    row ? compResource(row.work.competitionId) : {}
  );
  return row
    ? ({
        ok: true,
        artwork: view(row.work, ctx.clock.now(), row.entryCode, row.entryTitle),
      } as const)
    : ({ ok: false, error: "not_found" } as const);
}

async function senderScope(ctx: UseCaseContext, includeSchoolFamily = false) {
  const actor = ctx.actor;
  if (actor.kind !== "user") throw new Error("unreachable");
  const institutions = (await grantsOf(ctx.db, actor.userId))
    .filter(
      (g) =>
        (g.role === "institution_coordinator" ||
          g.role === "institution_admin") &&
        g.scope.type === "institution"
    )
    .flatMap((g) => (g.scope.type === "institution" ? [g.scope.id] : []));
  const visible = await visibleProfiles(ctx.db, actor.userId);
  const profiles = [...visible.keys()];
  const familyProfiles = [...visible]
    .filter(([, access]) => access.pays)
    .map(([id]) => id);
  const regs = profiles.length
    ? await ctx.db
        .select({ id: registration.id })
        .from(registration)
        .where(
          and(
            inArray(registration.participantProfileId, profiles),
            eq(registration.route, "individual")
          )
        )
    : [];
  const schoolFamily =
    includeSchoolFamily && familyProfiles.length
      ? await ctx.db
          .select({ id: registration.id })
          .from(registration)
          .where(
            and(
              inArray(registration.participantProfileId, familyProfiles),
              eq(registration.route, "institution")
            )
          )
      : [];
  const schools = institutions.length
    ? await ctx.db
        .select({ id: institutionRegistration.id })
        .from(institutionRegistration)
        .where(inArray(institutionRegistration.institutionId, institutions))
    : [];
  const scope = or(
    regs.length
      ? and(
          isNull(physicalArtwork.institutionRegistrationId),
          inArray(
            physicalArtwork.registrationId,
            regs.map((r) => r.id)
          )
        )
      : undefined,
    schoolFamily.length
      ? inArray(
          physicalArtwork.registrationId,
          schoolFamily.map((r) => r.id)
        )
      : undefined,
    schools.length
      ? inArray(
          physicalArtwork.institutionRegistrationId,
          schools.map((r) => r.id)
        )
      : undefined
  );
  return {
    scope,
    familySchoolIds: new Set(schoolFamily.map((r) => r.id)),
    institutionRegistrationIds: new Set(schools.map((r) => r.id)),
  };
}
async function listMyArtworks(ctx: UseCaseContext) {
  await authorize(ctx, "artwork.list_mine");
  const { scope, familySchoolIds, institutionRegistrationIds } =
    await senderScope(ctx, true);
  const rows = scope
    ? await ctx.db
        .select({
          work: physicalArtwork,
          entryCode: entry.code,
          entryTitle: entry.title,
        })
        .from(physicalArtwork)
        .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
        .where(scope)
        .orderBy(...ordered)
    : [];
  return {
    ok: true,
    artworks: await Promise.all(
      rows.map(async (row) => ({
        ...view(row.work, ctx.clock.now(), row.entryCode, row.entryTitle),
        familySender:
          row.work.institutionRegistrationId === null ||
          familySchoolIds.has(row.work.registrationId),
        institutionSender:
          row.work.institutionRegistrationId !== null &&
          institutionRegistrationIds.has(row.work.institutionRegistrationId),
        ...(await returnSummary(ctx, row.work)),
      }))
    ),
  } as const;
}
const dispatchInput = z.object({
  artworkIds: ids,
  courierName: z.string().max(500),
  trackingNumber: z.string().max(500),
});
async function recordArtworkDispatch(
  ctx: UseCaseContext,
  input: z.input<typeof dispatchInput>
) {
  await authorize(ctx, "artwork.list_mine");
  const parsed = dispatchInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const actor = ctx.actor;
  if (actor.kind !== "user") throw new Error("unreachable");
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const { scope } = await senderScope(scoped);
    if (!scope) return { ok: false, error: "not_found" } as const;
    const rows = await tx
      .select()
      .from(physicalArtwork)
      .where(and(scope, inArray(physicalArtwork.id, parsed.data.artworkIds)))
      .orderBy(asc(physicalArtwork.id))
      .for("update");
    if (rows.length !== parsed.data.artworkIds.length)
      return { ok: false, error: "not_found" } as const;
    const key = (r: PhysicalArtworkRow) =>
      r.institutionRegistrationId ?? r.registrationId;
    if (new Set(rows.map(key)).size !== 1)
      return { ok: false, error: "mixed_senders" } as const;
    const first = rows[0]!;
    const school = first.institutionRegistrationId
      ? await tx
          .select()
          .from(institutionRegistration)
          .where(
            eq(institutionRegistration.id, first.institutionRegistrationId)
          )
      : [];
    const { role } = school[0]
      ? await authorize(
          scoped,
          "artwork.dispatch_for_student",
          institutionResource(school[0].institutionId)
        )
      : await authorize(scoped, "artwork.dispatch", { ownerId: actor.userId });
    const now = ctx.clock.now();
    const plans = [];
    for (const row of rows) {
      const decision = decideArtwork(
        row,
        { kind: "dispatch", details: parsed.data },
        now
      );
      if (!decision.ok) return { ok: false, error: decision.code } as const;
      if (decision.to !== "dispatched") throw new Error("unreachable");
      plans.push({ row, decision });
    }
    for (const { row, decision } of plans) {
      await tx
        .update(physicalArtwork)
        .set({
          status: "dispatched",
          courierName: decision.courierName,
          trackingNumber: decision.trackingNumber,
          dispatchedBy: actor.userId,
          dispatchedAt: now,
        })
        .where(eq(physicalArtwork.id, row.id));
      await recordAudit(tx, ctx, {
        action: "physical_artwork.dispatched",
        entity: { type: "physical_artwork", id: row.id },
        before: { status: row.status },
        after: { status: "dispatched", late: decision.late },
        actorRole: role,
      });
      await emit(tx, ctx.clock, {
        type: "artwork.dispatched",
        aggregate: { type: "physical_artwork", id: row.id },
        payload: { artworkId: row.id, late: decision.late },
      });
    }
    return { ok: true } as const;
  });
}
async function markArtworkReceived(
  ctx: UseCaseContext,
  input: { artworkId: string }
) {
  const parsed = z.object({ artworkId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.receive");
    return invalidInput(parsed.error);
  }
  const actor = ctx.actor;
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(physicalArtwork)
      .where(eq(physicalArtwork.id, parsed.data.artworkId))
      .for("update");
    const { role } = await authorize(
      { ...ctx, db: tx },
      "artwork.receive",
      row ? compResource(row.competitionId) : {}
    );
    if (actor.kind !== "user") throw new Error("unreachable");
    if (!row) return { ok: false, error: "not_found" } as const;
    const now = ctx.clock.now();
    const decision = decideArtwork(row, { kind: "receive" }, now);
    if (!decision.ok) return { ok: false, error: decision.code } as const;
    if (decision.to !== "received") throw new Error("unreachable");
    await tx
      .update(physicalArtwork)
      .set({ status: "received", receivedBy: actor.userId, receivedAt: now })
      .where(eq(physicalArtwork.id, row.id));
    await tx.insert(artworkCustodyEvent).values({
      id: nextCustodyId(now),
      artworkId: row.id,
      kind: "received",
      actorUserId: actor.userId,
      at: now,
    });
    await recordAudit(tx, ctx, {
      action: "physical_artwork.received",
      entity: { type: "physical_artwork", id: row.id },
      before: { status: row.status },
      after: {
        status: "received",
        dispatchRecorded: decision.dispatchRecorded,
      },
      actorRole: role,
    });
    await emit(tx, ctx.clock, {
      type: "artwork.received",
      aggregate: { type: "physical_artwork", id: row.id },
      payload: {
        artworkId: row.id,
        dispatchRecorded: decision.dispatchRecorded,
      },
    });
    return { ok: true } as const;
  });
}

// The staff board displays only competitions covered by the actor's grant.
async function listArtworkCompetitions(ctx: UseCaseContext) {
  await authorize(ctx, "artwork.list_mine");
  const comps = await ctx.db
    .select({
      id: competition.id,
      code: competition.code,
      name: competition.name,
      rule: competition.physicalArtwork,
    })
    .from(competition)
    .orderBy(asc(competition.name));
  const visible = [];
  for (const comp of comps) {
    if ((await can(ctx, "artwork.read", compResource(comp.id))).allowed)
      visible.push(comp);
  }
  if (!visible.length) await authorize(ctx, "artwork.read");
  return visible;
}
async function listArtworkCandidates(
  ctx: UseCaseContext,
  input: { competitionId: string }
) {
  await authorize(ctx, "artwork.read", compResource(input.competitionId));
  const mayRequest = (
    await can(ctx, "artwork.request", compResource(input.competitionId))
  ).allowed;
  const rows = await ctx.db
    .select({ id: entry.id, code: entry.code, title: entry.title })
    .from(entry)
    .leftJoin(physicalArtwork, eq(physicalArtwork.entryId, entry.id))
    .where(
      and(
        eq(entry.competitionId, input.competitionId),
        eq(entry.status, "foa_verified"),
        isNull(physicalArtwork.id)
      )
    )
    .orderBy(asc(entry.code));
  return {
    mayRequest,
    entries: mayRequest ? rows : [],
    settings: await requestSettings(ctx),
  };
}
export const physicalArtworkUseCases = (ctx: UseCaseContext) => ({
  ...custodyUseCases(ctx),
  requestPhysicalArtwork: (input: z.input<typeof requestInput>) =>
    requestPhysicalArtwork(ctx, input),
  recordArtworkDispatch: (input: z.input<typeof dispatchInput>) =>
    recordArtworkDispatch(ctx, input),
  markArtworkReceived: (input: { artworkId: string }) =>
    markArtworkReceived(ctx, input),
  listArtworks: (input: z.input<typeof listInput>) => listArtworks(ctx, input),
  getArtwork: (input: { artworkCode: string }) => getArtwork(ctx, input),
  listMyArtworks: () => listMyArtworks(ctx),
  listArtworkCompetitions: () => listArtworkCompetitions(ctx),
  listArtworkCandidates: (input: { competitionId: string }) =>
    listArtworkCandidates(ctx, input),
});
