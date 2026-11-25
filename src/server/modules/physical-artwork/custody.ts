// Every change takes the artwork row lock before evaluating the custody
// decision. The state, evidence, custody event, audit and outbox commit
// together. The worker uses the same decision as the staff action.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorize, can } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  artworkCustodyEvent,
  artworkDiscrepancy,
  artworkPhoto,
  artworkResultsWindow,
  artworkReturnRequest,
  artworkVerification,
  entry,
  entryFile,
  fileAsset,
  institutionRegistration,
  physicalArtwork,
  participantProfile,
  registration,
  type PhysicalArtworkRow,
} from "../../db/schema";
import { monotonicUuidv7, uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import type { OutboxDeps } from "../../outbox";
import { moduleDerivativeUrl } from "../files/use-cases/derivative-url";
import { presignUpload } from "../files/use-cases/upload";
import { hasCleanScan } from "../files/use-cases/clean-scan";
import { DOWNLOAD_URL_TTL_SECONDS } from "../files/use-cases/delivery";
import { dispositionFor, downloadFilenameFor } from "../files/domain/delivery";
import { visibleProfiles } from "../participants/list-my-registrations";
import {
  decideCustody,
  CONDITION_PHOTO_KINDS,
  type CustodyCommand,
  type CustodyState,
  type ChecklistItem,
  type VerificationInput,
  type ReturnVia,
} from "./domain/custody";
import { artworkTransition } from "./domain/status";

export const nextCustodyId = monotonicUuidv7();

const resource = (competitionId: string) => ({
  scopes: [{ type: "competition" as const, id: competitionId }],
});
const artworkInput = z.object({ artworkId: z.uuid() });
const locationInput = artworkInput.extend({ location: z.string().max(500) });
const verificationInput = artworkInput.extend({
  checklist: z.object({
    codeMatchesLabel: z.boolean(),
    creatorConfirmed: z.boolean(),
    matchesDigital: z.boolean(),
    consentDocumentsOk: z.boolean(),
  }),
  condition: z.string().max(100),
  conditionNotes: z.string().max(5000).nullable(),
  widthMm: z.number(),
  heightMm: z.number(),
  depthMm: z.number().nullable(),
  material: z.string().max(500),
  storageLocation: z.string().max(500),
  photos: z
    .array(z.object({ fileId: z.uuid(), kind: z.enum(CONDITION_PHOTO_KINDS) }))
    .max(50),
});
const raiseInput = artworkInput.extend({
  reason: z.string().max(500),
  notes: z.string().max(5000).nullable(),
});
const resolveInput = artworkInput.extend({
  resolution: z.string().max(5000).nullable(),
});
const returnInput = artworkInput.extend({
  via: z.discriminatedUnion("method", [
    z.object({
      method: z.literal("courier"),
      courierName: z.string().max(500),
      trackingNumber: z.string().max(500),
    }),
    z.object({
      method: z.literal("hand_over"),
      receivedBy: z.string().max(500),
    }),
  ]),
});
const uploadInput = artworkInput.extend({
  kind: z.enum(CONDITION_PHOTO_KINDS),
  contentType: z.string().max(100),
  sizeBytes: z.number().int(),
});
type StaffAction = "artwork.verify" | "artwork.manage_custody" | "artwork.read";
type CustodyContext = Pick<UseCaseContext, "db" | "clock" | "actor">;
type Result =
  | { ok: true }
  | { ok: false; error: string; failed?: ChecklistItem[] };

async function getWork(db: AppDb, artworkId: string, lock = false) {
  const q = db
    .select()
    .from(physicalArtwork)
    .where(eq(physicalArtwork.id, artworkId));
  const [work] = lock ? await q.for("update") : await q;
  return work;
}

async function stateOf(
  db: AppDb,
  work: PhysicalArtworkRow
): Promise<CustodyState> {
  const [window] = await db
    .select()
    .from(artworkResultsWindow)
    .where(eq(artworkResultsWindow.competitionId, work.competitionId));
  const [request] = await db
    .select()
    .from(artworkReturnRequest)
    .where(
      and(
        eq(artworkReturnRequest.artworkId, work.id),
        isNull(artworkReturnRequest.fulfilledAt)
      )
    );
  return {
    status: work.status,
    retainedAt: work.retainedAt,
    returnWindow: window
      ? { opensAt: window.resultsPublishedAt, closesAt: window.closesAt }
      : null,
    returnRequested: Boolean(request),
  };
}

async function applyCustody(
  ctx: CustodyContext,
  work: PhysicalArtworkRow,
  command: CustodyCommand,
  role: Role | null
): Promise<Result> {
  const tx = ctx.db;
  const now = ctx.clock.now();
  const state = await stateOf(tx, work);
  const decision = decideCustody(state, command, now);
  if (!decision.ok)
    return {
      ok: false,
      error: decision.code,
      ...(decision.failed ? { failed: decision.failed } : {}),
    };
  if (
    work.status !== decision.to &&
    !artworkTransition(work.status, decision.to)
  )
    throw new Error("Unlisted custody transition");
  const actorId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  if (decision.kind === "verify") {
    const { checklist, photos, ...details } = decision.verification;
    await tx.insert(artworkVerification).values({
      artworkId: work.id,
      verifiedAt: now,
      verifiedBy: actorId,
      ...checklist,
      ...details,
    });
    await tx
      .update(artworkPhoto)
      .set({ selectedAt: now })
      .where(
        and(
          eq(artworkPhoto.artworkId, work.id),
          inArray(
            artworkPhoto.fileAssetId,
            photos.map((p) => p.fileId)
          )
        )
      );
  }
  if (decision.kind === "raise_discrepancy") {
    await tx.insert(artworkDiscrepancy).values({
      id: uuidv7(now),
      artworkId: work.id,
      ...decision.discrepancy,
      raisedAt: now,
      raisedBy: actorId,
    });
  }
  if (decision.kind === "resolve_discrepancy") {
    const rows = await tx
      .update(artworkDiscrepancy)
      .set({
        resolution: decision.resolution,
        resolvedAt: now,
        resolvedBy: actorId,
      })
      .where(
        and(
          eq(artworkDiscrepancy.artworkId, work.id),
          isNull(artworkDiscrepancy.resolvedAt)
        )
      )
      .returning({ id: artworkDiscrepancy.id });
    if (rows.length !== 1) throw new Error("Discrepancy state missing");
  }
  if (decision.kind === "request_return") {
    await tx
      .insert(artworkReturnRequest)
      .values({ artworkId: work.id, requestedBy: actorId, requestedAt: now });
  }
  if (decision.kind === "record_return") {
    if (state.returnRequested)
      await tx
        .update(artworkReturnRequest)
        .set({ fulfilledAt: now, via: decision.via })
        .where(eq(artworkReturnRequest.artworkId, work.id));
    if (work.status === "discrepancy") {
      await tx
        .update(artworkDiscrepancy)
        .set({
          resolution: "Artwork returned",
          resolvedAt: now,
          resolvedBy: actorId,
        })
        .where(
          and(
            eq(artworkDiscrepancy.artworkId, work.id),
            isNull(artworkDiscrepancy.resolvedAt)
          )
        );
    }
  }
  const location =
    decision.kind === "record_return"
      ? null
      : (decision.custody?.location ?? work.storageLocation);
  await tx
    .update(physicalArtwork)
    .set({
      status: decision.to,
      storageLocation: location,
      ...(decision.kind === "retain"
        ? { retainedAt: work.retainedAt ?? now }
        : {}),
    })
    .where(eq(physicalArtwork.id, work.id));
  if (decision.custody) {
    await tx.insert(artworkCustodyEvent).values({
      id: nextCustodyId(now),
      artworkId: work.id,
      ...decision.custody,
      actorUserId: actorId,
      at: now,
      returnVia: decision.kind === "record_return" ? decision.via : null,
    });
  }
  await recordAudit(tx, ctx, {
    action:
      decision.event?.replace("artwork.", "physical_artwork.") ??
      "physical_artwork.moved",
    entity: { type: "physical_artwork", id: work.id },
    before: { status: work.status },
    after: { status: decision.to },
    actorRole: role,
  });
  if (decision.event)
    await emit(tx, ctx.clock, {
      type: decision.event,
      aggregate: { type: "physical_artwork", id: work.id },
      payload: { artworkId: work.id },
    });
  return { ok: true };
}

async function staffCommand<T extends { artworkId: string }>(
  ctx: UseCaseContext,
  schema: z.ZodType<T>,
  input: unknown,
  action: StaffAction,
  command: (data: T) => CustodyCommand
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, action);
    return invalidInput(parsed.error);
  }
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const work = await getWork(tx, parsed.data.artworkId, true);
    const { role } = await authorize(
      scoped,
      action,
      work ? resource(work.competitionId) : {}
    );
    if (!work) return { ok: false, error: "not_found" } as const;
    return applyCustody(scoped, work, command(parsed.data), role);
  });
}

async function verifyArtwork(
  ctx: UseCaseContext,
  input: z.input<typeof verificationInput>
) {
  const parsed = verificationInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.verify");
    return invalidInput(parsed.error);
  }
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const work = await getWork(tx, parsed.data.artworkId, true);
    const { role } = await authorize(
      scoped,
      "artwork.verify",
      work ? resource(work.competitionId) : {}
    );
    if (!work) return { ok: false, error: "not_found" } as const;
    const state = await stateOf(tx, work);
    // Status refusal has precedence over any photo selection.
    if (state.status !== "received")
      return applyCustody(
        scoped,
        work,
        { kind: "verify", input: { ...parsed.data, photos: [] } },
        role
      );
    const files = parsed.data.photos.length
      ? await tx
          .select({ photo: artworkPhoto, file: fileAsset })
          .from(artworkPhoto)
          .innerJoin(fileAsset, eq(fileAsset.id, artworkPhoto.fileAssetId))
          .where(
            and(
              eq(artworkPhoto.artworkId, work.id),
              inArray(
                artworkPhoto.fileAssetId,
                parsed.data.photos.map((p) => p.fileId)
              )
            )
          )
          .for("update", { of: fileAsset })
      : [];
    const photos: VerificationInput["photos"][number][] = [];
    for (const requested of parsed.data.photos) {
      const row = files.find(
        (r) =>
          r.file.id === requested.fileId &&
          r.photo.kind === requested.kind &&
          r.file.purpose === "artwork_condition_photo"
      );
      if (!row) return { ok: false, error: "invalid_photo" } as const;
      photos.push({
        ...requested,
        fileStatus: (await hasCleanScan(ctx.storage, row.file))
          ? "clean"
          : "unavailable",
      });
    }
    return applyCustody(
      scoped,
      work,
      { kind: "verify", input: { ...parsed.data, photos } },
      role
    );
  });
}

async function requestArtworkPhotoUpload(
  ctx: UseCaseContext,
  input: z.input<typeof uploadInput>
) {
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.verify");
    return invalidInput(parsed.error);
  }
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const work = await getWork(tx, parsed.data.artworkId, true);
    await authorize(
      scoped,
      "artwork.verify",
      work ? resource(work.competitionId) : {}
    );
    if (!work) return { ok: false, error: "not_found" } as const;
    if (work.status !== "received")
      return { ok: false, error: "not_received" } as const;
    if (ctx.actor.kind !== "user") throw new Error("unreachable");
    const result = await presignUpload(ctx, tx, {
      purpose: "artwork_condition_photo",
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
    });
    if (!result.ok) return result;
    const now = ctx.clock.now();
    const photoId = uuidv7(now);
    await tx.insert(artworkPhoto).values({
      id: photoId,
      artworkId: work.id,
      fileAssetId: result.fileId,
      kind: parsed.data.kind,
      createdBy: ctx.actor.userId,
      createdAt: now,
    });
    return { ...result, photoId };
  });
}

async function getArtworkPhotoUrl(
  ctx: UseCaseContext,
  input: { photoId: string }
) {
  const parsed = z.object({ photoId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.read");
    return invalidInput(parsed.error);
  }
  const [row] = await ctx.db
    .select({
      photo: artworkPhoto,
      file: fileAsset,
      competitionId: physicalArtwork.competitionId,
    })
    .from(artworkPhoto)
    .innerJoin(fileAsset, eq(fileAsset.id, artworkPhoto.fileAssetId))
    .innerJoin(physicalArtwork, eq(physicalArtwork.id, artworkPhoto.artworkId))
    .where(eq(artworkPhoto.id, parsed.data.photoId));
  const { role } = await authorize(
    ctx,
    "artwork.read",
    row ? resource(row.competitionId) : {}
  );
  if (!row || row.file.purpose !== "artwork_condition_photo")
    return { ok: false, error: "not_found" } as const;
  if (!(await hasCleanScan(ctx.storage, row.file)))
    return { ok: false, error: "photo_not_ready" } as const;
  const now = ctx.clock.now();
  const { url } = await ctx.storage.presignGet({
    bucket: row.file.bucket,
    key: row.file.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    contentType: row.file.contentType,
    disposition: dispositionFor(row.file.contentType),
    filename: downloadFilenameFor({
      purpose: row.file.purpose,
      fileId: row.file.id,
      contentType: row.file.contentType,
    }),
  });
  await recordAudit(ctx.db, ctx, {
    action: "file.read",
    entity: { type: "file_asset", id: row.file.id },
    before: null,
    after: null,
    actorRole: role,
  });
  return {
    ok: true,
    url,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  } as const;
}

async function requesterResource(
  ctx: CustodyContext,
  work: PhysicalArtworkRow
) {
  if (ctx.actor.kind !== "user") return {};
  const [reg] = await ctx.db
    .select()
    .from(registration)
    .where(eq(registration.id, work.registrationId));
  if (!reg) return {};
  // A teen's own login cannot request a return. Their verified guardian,
  // an adult creator or the school's authorised coordinators may.
  const visible = await visibleProfiles(ctx.db, ctx.actor.userId);
  if (visible.get(reg.participantProfileId)?.pays)
    return { ownerId: ctx.actor.userId };
  if (work.institutionRegistrationId) {
    const [school] = await ctx.db
      .select()
      .from(institutionRegistration)
      .where(eq(institutionRegistration.id, work.institutionRegistrationId));
    if (school)
      return {
        scopes: [{ type: "institution" as const, id: school.institutionId }],
      };
  }
  return {};
}

async function requestArtworkReturn(
  ctx: UseCaseContext,
  input: { artworkId: string }
) {
  const parsed = artworkInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.request_return");
    return invalidInput(parsed.error);
  }
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const work = await getWork(tx, parsed.data.artworkId, true);
    const { role } = await authorize(
      scoped,
      "artwork.request_return",
      work ? await requesterResource(scoped, work) : {}
    );
    if (!work) return { ok: false, error: "not_found" } as const;
    return applyCustody(scoped, work, { kind: "request_return" }, role);
  });
}

export async function returnSummary(
  ctx: UseCaseContext,
  work: PhysicalArtworkRow
) {
  const { returnWindow, returnRequested } = await stateOf(ctx.db, work);
  const allowed = await can(
    ctx,
    "artwork.request_return",
    await requesterResource(ctx, work)
  );
  const refusal = decideCustody(
    {
      status: work.status,
      retainedAt: work.retainedAt,
      returnWindow,
      returnRequested,
    },
    { kind: "request_return" },
    ctx.clock.now()
  );
  return {
    returnWindow,
    returnRequested,
    mayRequestReturn: allowed.allowed && refusal.ok,
  };
}

async function getArtworkCustody(
  ctx: UseCaseContext,
  input: { artworkId: string }
) {
  const parsed = artworkInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.read");
    return invalidInput(parsed.error);
  }
  const work = await getWork(ctx.db, parsed.data.artworkId);
  await authorize(
    ctx,
    "artwork.read",
    work ? resource(work.competitionId) : {}
  );
  if (!work) return { ok: false, error: "not_found" } as const;
  const [verification] = await ctx.db
    .select()
    .from(artworkVerification)
    .where(eq(artworkVerification.artworkId, work.id));
  const photos = await ctx.db
    .select({
      id: artworkPhoto.id,
      fileId: artworkPhoto.fileAssetId,
      kind: artworkPhoto.kind,
      selectedAt: artworkPhoto.selectedAt,
      status: fileAsset.status,
      contentType: fileAsset.contentType,
    })
    .from(artworkPhoto)
    .innerJoin(fileAsset, eq(fileAsset.id, artworkPhoto.fileAssetId))
    .where(eq(artworkPhoto.artworkId, work.id))
    .orderBy(asc(artworkPhoto.createdAt), asc(artworkPhoto.id));
  const discrepancies = await ctx.db
    .select()
    .from(artworkDiscrepancy)
    .where(eq(artworkDiscrepancy.artworkId, work.id))
    .orderBy(asc(artworkDiscrepancy.raisedAt));
  const events = await ctx.db
    .select()
    .from(artworkCustodyEvent)
    .where(eq(artworkCustodyEvent.artworkId, work.id))
    .orderBy(asc(artworkCustodyEvent.at), asc(artworkCustodyEvent.id));
  const [request] = await ctx.db
    .select()
    .from(artworkReturnRequest)
    .where(eq(artworkReturnRequest.artworkId, work.id));
  const [digital] = await ctx.db
    .select({ asset: entryFile.fileAssetId })
    .from(entryFile)
    .where(
      and(
        eq(entryFile.entryId, work.entryId),
        eq(entryFile.status, "live"),
        eq(entryFile.kind, "image")
      )
    );
  const picture = digital?.asset
    ? await moduleDerivativeUrl(ctx, digital.asset, "display_1600")
    : null;
  const [creator] = await ctx.db
    .select({
      name: participantProfile.fullName,
      code: participantProfile.participantCode,
    })
    .from(entry)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, entry.participantProfileId)
    )
    .where(eq(entry.id, work.entryId));
  const state = await stateOf(ctx.db, work);
  return {
    ok: true,
    creator: creator ?? null,
    status: work.status,
    storageLocation: work.storageLocation,
    retainedAt: work.retainedAt,
    verification: verification ?? null,
    photos,
    discrepancies,
    events,
    returnRequest: request ?? null,
    returnWindow: state.returnWindow,
    picture,
    mayVerify: (await can(ctx, "artwork.verify", resource(work.competitionId)))
      .allowed,
    mayManage: (
      await can(ctx, "artwork.manage_custody", resource(work.competitionId))
    ).allowed,
  } as const;
}

async function listArtworkDiscrepancies(
  ctx: UseCaseContext,
  input: { competitionId?: string }
) {
  const parsed = z
    .object({ competitionId: z.uuid().optional() })
    .safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "artwork.verify");
    return invalidInput(parsed.error);
  }
  await authorize(
    ctx,
    "artwork.verify",
    parsed.data.competitionId ? resource(parsed.data.competitionId) : {}
  );
  const rows = await ctx.db
    .select({
      discrepancy: artworkDiscrepancy,
      artworkCode: physicalArtwork.artworkCode,
      entryCode: entry.code,
    })
    .from(artworkDiscrepancy)
    .innerJoin(
      physicalArtwork,
      eq(physicalArtwork.id, artworkDiscrepancy.artworkId)
    )
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .where(
      and(
        isNull(artworkDiscrepancy.resolvedAt),
        parsed.data.competitionId
          ? eq(physicalArtwork.competitionId, parsed.data.competitionId)
          : undefined
      )
    )
    .orderBy(asc(artworkDiscrepancy.raisedAt), asc(artworkDiscrepancy.id));
  return { ok: true, discrepancies: rows } as const;
}

export async function retainUnrequested(
  deps: OutboxDeps,
  input: { competitionId: string }
) {
  await deps.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(physicalArtwork)
      .where(
        and(
          eq(physicalArtwork.competitionId, input.competitionId),
          inArray(physicalArtwork.status, ["verified", "on_exhibition"])
        )
      )
      .orderBy(asc(physicalArtwork.entryId))
      .for("update");
    for (const work of rows)
      await applyCustody(
        {
          db: tx,
          clock: deps.clock,
          actor: { kind: "system", process: "worker" },
        },
        work,
        { kind: "retain" },
        null
      );
  });
}

export const custodyUseCases = (ctx: UseCaseContext) => ({
  verifyArtwork: (input: z.input<typeof verificationInput>) =>
    verifyArtwork(ctx, input),
  requestArtworkPhotoUpload: (input: z.input<typeof uploadInput>) =>
    requestArtworkPhotoUpload(ctx, input),
  getArtworkPhotoUrl: (input: { photoId: string }) =>
    getArtworkPhotoUrl(ctx, input),
  getArtworkCustody: (input: { artworkId: string }) =>
    getArtworkCustody(ctx, input),
  listArtworkDiscrepancies: (input: { competitionId?: string }) =>
    listArtworkDiscrepancies(ctx, input),
  raiseArtworkDiscrepancy: (input: z.input<typeof raiseInput>) =>
    staffCommand(ctx, raiseInput, input, "artwork.verify", (x) => ({
      kind: "raise_discrepancy",
      reason: x.reason,
      notes: x.notes,
    })),
  resolveArtworkDiscrepancy: (input: z.input<typeof resolveInput>) =>
    staffCommand(ctx, resolveInput, input, "artwork.manage_custody", (x) => ({
      kind: "resolve_discrepancy",
      resolution: x.resolution,
    })),
  exhibitArtwork: (input: z.input<typeof locationInput>) =>
    staffCommand(ctx, locationInput, input, "artwork.manage_custody", (x) => ({
      kind: "exhibit",
      location: x.location,
    })),
  storeArtwork: (input: z.input<typeof locationInput>) =>
    staffCommand(ctx, locationInput, input, "artwork.manage_custody", (x) => ({
      kind: "store",
      location: x.location,
    })),
  moveArtwork: (input: z.input<typeof locationInput>) =>
    staffCommand(ctx, locationInput, input, "artwork.manage_custody", (x) => ({
      kind: "move",
      location: x.location,
    })),
  retainArtwork: (input: { artworkId: string }) =>
    staffCommand(ctx, artworkInput, input, "artwork.manage_custody", () => ({
      kind: "retain",
    })),
  recordArtworkReturn: (input: { artworkId: string; via: ReturnVia }) =>
    staffCommand(ctx, returnInput, input, "artwork.manage_custody", (x) => ({
      kind: "record_return",
      via: x.via,
    })),
  requestArtworkReturn: (input: { artworkId: string }) =>
    requestArtworkReturn(ctx, input),
});
