import { createHash } from "node:crypto";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize, type PolicyContext } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { competition, competitionAgeGroup, competitionAwardScheme, entry, judgingRound, registration, resultAward, resultRelease, roundResult, user, type ResultAward, type ResultRelease } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { emit, emitBatch } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { AWARD_BANDS } from "../competitions/domain/award-schemes";
import { canTransition } from "../competitions/domain/status-machine";
import { competitionScope } from "../judging/rounds";
import { canTransitionRelease } from "./domain/release-status";

const competitionInput = z.object({ competitionId: z.uuid() });
const prepareInput = competitionInput.extend({
  sourceRoundId: z.uuid(),
  publishAt: z.iso.datetime(),
  deliveryNote: z.string().trim().min(10).max(500).refine((v) => !v.includes("\u0000")),
});
const releaseInput = competitionInput.extend({ releaseId: z.uuid() });
export type PrepareResultsInput = z.input<typeof prepareInput>;
export type ReleaseInput = z.input<typeof releaseInput>;
const notFound = { ok: false, error: "not_found" } as const;
const currentRelease = (db: AppDb, competitionId: string) => db.select().from(resultRelease)
  .where(and(eq(resultRelease.competitionId, competitionId), ne(resultRelease.status, "rejected")));

// Always acquire competition before round/release locks. Chain changes take the
// same competition lock; recognition updates serialize on the source round.
async function lockCompetition(db: AppDb, competitionId: string) {
  const [row] = await db.select().from(competition).where(eq(competition.id, competitionId)).for("update");
  return row;
}
async function loadFinalRound(db: AppDb, competitionId: string, sourceRoundId: string) {
  const [round] = await db.select().from(judgingRound).where(and(eq(judgingRound.id, sourceRoundId), eq(judgingRound.competitionId, competitionId))).for("update");
  if (!round || round.status !== "locked") return null;
  const [next] = await db.select({ id: judgingRound.id }).from(judgingRound).where(and(eq(judgingRound.sourceRoundId, round.id), ne(judgingRound.status, "cancelled"))).limit(1);
  return next ? null : round;
}
async function lockActor(ctx: PolicyContext) {
  if (ctx.actor.kind === "user") await ctx.db.select({id:user.id}).from(user).where(eq(user.id, ctx.actor.userId)).for("no key update");
}

function snapshotHash(release: Pick<ResultRelease, "id" | "competitionId" | "sourceRoundId" | "publishAt" | "deliveryNote">, lines: readonly ResultAward[]) {
  const rows = [...lines].sort((a,b)=>a.entryId.localeCompare(b.entryId)).map((line) => [line.entryId, line.discipline, line.categoryId, line.categoryLabel, line.outcome, line.awardPosition, line.awardBand, line.prize, line.suitableForAuction]);
  return createHash("sha256").update(JSON.stringify([1,release.id,release.competitionId,release.sourceRoundId,release.publishAt.toISOString(),release.deliveryNote,rows])).digest("hex");
}
async function awardRows(db: AppDb, releaseId: string) {
  return db.select().from(resultAward).where(eq(resultAward.releaseId, releaseId)).orderBy(asc(resultAward.discipline), asc(resultAward.categoryLabel), asc(resultAward.awardPosition), asc(resultAward.outcome), asc(resultAward.entryId));
}

export async function prepareResultsRelease(ctx: UseCaseContext, input: PrepareResultsInput) {
  await authorize(ctx, "results.prepare", competitionScope(input.competitionId));
  const parsed = prepareInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("A staff member must prepare results");
  const preparedByUserId = ctx.actor.userId;
  const { competitionId, sourceRoundId, deliveryNote } = parsed.data;
  const publishAt = new Date(parsed.data.publishAt);
  return ctx.db.transaction(async (tx) => {
    const locked = await lockCompetition(tx, competitionId);
    const round = await loadFinalRound(tx, competitionId, sourceRoundId);
    const local = { ...ctx, db: tx };
    await lockActor(local);
    const { role } = await authorize(local, "results.prepare", competitionScope(competitionId));
    if (!locked) return notFound;
    if (locked.status !== "foa_judging") return { ok: false, error: "competition_not_judging" } as const;
    if (!round) return { ok: false, error: "final_round_required" } as const;
    const now = ctx.clock.now();
    if (publishAt <= now) return { ok: false, error: "publish_time_required" } as const;
    if ((await currentRelease(tx, competitionId)).length) return { ok: false, error: "release_exists" } as const;
    const [plan] = await tx.select().from(competitionAwardScheme).where(and(eq(competitionAwardScheme.competitionId, competitionId), eq(competitionAwardScheme.round, "foa_final")));
    const recognition = await tx.select({entryId: roundResult.entryId, discipline: roundResult.discipline, categoryId: roundResult.categoryId, categoryLabel: competitionAgeGroup.label, outcome: roundResult.outcome, awardPosition:roundResult.awardPosition,suitableForAuction:roundResult.suitableForAuction})
      .from(roundResult).innerJoin(competitionAgeGroup, eq(competitionAgeGroup.id, roundResult.categoryId))
      .where(and(eq(roundResult.roundId, round.id), ne(roundResult.outcome, "none")));
    const id = uuidv7(now);
    const lines: ResultAward[] = recognition.map((line) => {
      const awardBand = line.awardPosition === null ? null : AWARD_BANDS[round.awardScheme][line.awardPosition - 1] ?? null;
      return { ...line, releaseId: id, awardBand, prize: awardBand && plan?.scheme === round.awardScheme ? plan.prizes[awardBand] ?? null : null };
    });
    // No fake winners: an intentionally empty, reasoned lock can release no awards.
    const draft = { id, competitionId, sourceRoundId, preparedByUserId, preparedAt: now, publishAt, deliveryNote };
    await tx.insert(resultRelease).values({ ...draft, contentHash: snapshotHash(draft, lines) });
    if (lines.length) await tx.insert(resultAward).values(lines);
    await recordAudit(tx, local, { action: "results.prepared", entity: { type: "result_release", id }, before:null, after:{ competitionId, sourceRoundId, publishAt:publishAt.toISOString(), count:lines.length }, actorRole:role });
    return { ok:true, releaseId:id } as const;
  });
}

export async function getResultsRelease(ctx: UseCaseContext, input: { competitionId: string }) {
  await authorize(ctx, "results.read", competitionScope(input.competitionId));
  if (!competitionInput.safeParse(input).success) return notFound;
  const [c] = await ctx.db.select({ id:competition.id, name:competition.name, slug:competition.slug, status:competition.status }).from(competition).where(eq(competition.id,input.competitionId));
  if (!c) return notFound;
  const rounds = await ctx.db.select({id:judgingRound.id,name:judgingRound.name,status:judgingRound.status,sourceRoundId:judgingRound.sourceRoundId}).from(judgingRound).where(eq(judgingRound.competitionId,c.id)).orderBy(asc(judgingRound.name));
  const finalRounds = rounds.filter(r=>r.status==="locked" && !rounds.some(next=>next.sourceRoundId===r.id && next.status!=="cancelled"));
  const [release] = await currentRelease(ctx.db,c.id);
  const awards = release ? await ctx.db.select({ ...awardColumns, entryCode:entry.code }).from(resultAward).innerJoin(entry,eq(entry.id,resultAward.entryId)).where(eq(resultAward.releaseId,release.id)).orderBy(asc(resultAward.discipline),asc(resultAward.categoryLabel),asc(resultAward.awardPosition),asc(entry.code)) : [];
  const rejected = await ctx.db.select({id:resultRelease.id,rejectedAt:resultRelease.rejectedAt}).from(resultRelease).where(and(eq(resultRelease.competitionId,c.id),eq(resultRelease.status,"rejected"))).orderBy(desc(resultRelease.preparedAt));
  return {ok:true,competition:c,finalRounds,release:release??null,awards,rejected} as const;
}
const awardColumns = { discipline:resultAward.discipline, categoryLabel:resultAward.categoryLabel, outcome:resultAward.outcome, awardBand:resultAward.awardBand, prize:resultAward.prize };

export async function decideResultsRelease(ctx: UseCaseContext, input: ReleaseInput, approve: boolean) {
  const action = approve ? "results.approve" : "results.reject";
  await authorize(ctx, action, competitionScope(input.competitionId));
  if (!releaseInput.safeParse(input).success) return notFound;
  if (ctx.actor.kind !== "user") throw new Error("A staff member must review results");
  const actorId=ctx.actor.userId;
  return ctx.db.transaction(async(tx)=>{
    const c = await lockCompetition(tx,input.competitionId);
    const [release] = await currentRelease(tx,input.competitionId).for("update");
    const local={...ctx,db:tx};
    await lockActor(local);
    const {role}=await authorize(local,action,competitionScope(input.competitionId));
    if (!c || !release || release.id!==input.releaseId) return notFound;
    if (!release.preparedByUserId || release.preparedByUserId===actorId) return {ok:false,error:"second_staff_required"} as const;
    const status=approve?"approved":"rejected";
    if (!canTransitionRelease(release.status,status,"approver")) return {ok:false,error:"release_not_reviewable"} as const;
    const now=ctx.clock.now();
    if (approve) {
      if (c.status!=="foa_judging") return {ok:false,error:"competition_not_judging"} as const;
      if (now>=release.publishAt) return {ok:false,error:"publish_time_required"} as const;
      if (!(await loadFinalRound(tx,c.id,release.sourceRoundId))) return {ok:false,error:"final_round_required"} as const;
      if (snapshotHash(release,await awardRows(tx,release.id))!==release.contentHash) return {ok:false,error:"release_changed"} as const;
      await tx.update(resultRelease).set({status,approvedByUserId:actorId,approvedAt:now}).where(eq(resultRelease.id,release.id));
      await emit(tx,ctx.clock,{ type:"results.release_due",aggregate:{type:"competition",id:c.id},payload:{competitionId:c.id,releaseId:release.id} },{availableAt:release.publishAt});
    } else {
      await tx.update(resultRelease).set({status,rejectedAt:now}).where(eq(resultRelease.id,release.id));
    }
    await recordAudit(tx,local,{action:approve?"results.approved":"results.rejected",entity:{type:"result_release",id:release.id},before:{status:release.status},after:{status,competitionId:c.id},actorRole:role});
    return {ok:true,status} as const;
  });
}

export async function publishResultsRelease(ctx: PolicyContext, input: ReleaseInput) {
  await authorize(ctx,"results.publish",competitionScope(input.competitionId));
  if (!releaseInput.safeParse(input).success) return notFound;
  return ctx.db.transaction(async(tx)=>{
    const c=await lockCompetition(tx,input.competitionId);
    const [release]=await currentRelease(tx,input.competitionId).for("update");
    if (!c || !release || release.id!==input.releaseId) return notFound;
    if (!canTransitionRelease(release.status,"published","system")) return {ok:true,outcome:"ignored"} as const;
    const now=ctx.clock.now();
    if(now<release.publishAt) return {ok:true,outcome:"early"} as const;
    const lines=await awardRows(tx,release.id);
    const valid=canTransition(c.status,"results_published","results") && !!release.approvedAt && !!(await loadFinalRound(tx,c.id,release.sourceRoundId)) && snapshotHash(release,lines)===release.contentHash;
    if(!valid){
      await tx.update(resultRelease).set({status:"rejected",rejectedAt:now}).where(eq(resultRelease.id,release.id));
      await recordAudit(tx,ctx,{action:"results.publication_refused",entity:{type:"result_release",id:release.id},before:{status:release.status},after:{status:"rejected",competitionId:c.id}});
      return {ok:true,outcome:"rejected"} as const;
    }
    await tx.update(resultRelease).set({status:"published",publishedAt:now}).where(eq(resultRelease.id,release.id));
    await tx.update(competition).set({status:"results_published",updatedAt:now}).where(eq(competition.id,c.id));
    await recordAudit(tx,ctx,{action:"results.published",entity:{type:"result_release",id:release.id},before:{status:release.status},after:{status:"published",competitionId:c.id,publishedAt:now.toISOString(),count:lines.length}});
    await emit(tx,ctx.clock,{type:"results.published",aggregate:{type:"competition",id:c.id},payload:{competitionId:c.id,releaseId:release.id,publishedAt:now.toISOString()}});
    // Fan-out is transactionally created once, one durable job per winner.
    const winners=await tx.select({entryId:resultAward.entryId,registrationId:entry.registrationId}).from(resultAward).innerJoin(entry,eq(entry.id,resultAward.entryId)).innerJoin(registration,eq(registration.id,entry.registrationId)).where(and(eq(resultAward.releaseId,release.id),eq(registration.status,"confirmed")));
    const awarded=new Set(lines.filter(l=>l.awardBand!==null).map(l=>l.entryId));
    await emitBatch(tx,ctx.clock,winners.filter(w=>awarded.has(w.entryId)).map(w=>({type:"results.prize_awarded",aggregate:{type:"competition",id:c.id},payload:{competitionId:c.id,releaseId:release.id,entryId:w.entryId,registrationId:w.registrationId}})));
    return {ok:true,outcome:"published"} as const;
  });
}
