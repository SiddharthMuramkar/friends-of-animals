import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ipNetwork } from "../../../lib/ip-network";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { galleryItem, galleryReport, galleryReportReason } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { formKeyedHash, publicSender, takeFormAllowance, type HumanCheckProof } from "../public-forms";
import { readSetting } from "../settings/read";
import { liveGallerySource } from "./evidence";
export type GalleryReportInput={itemId:string;reason:string;details?:string;contact?:string;website?:string;humanCheck?:HumanCheckProof};
const inputSchema=z.object({itemId:z.uuid(),reason:z.enum(galleryReportReason.enumValues),details:z.string().trim().max(1000).optional(),contact:z.union([z.email().max(254),z.literal("")]).optional()});
const proofSchema=z.object({token:z.string().max(2000),nonce:z.int().nonnegative()});
const refusal=<T extends string>(error:T)=>({ok:false,error} as const);
type AnswerValue={ok:true}|{ok:false;error:string;retryAfter?:Date};
class Answer extends Error { constructor(readonly value:AnswerValue){super("Gallery report refused");} }
export async function reportGalleryItem(ctx:UseCaseContext,input:GalleryReportInput):Promise<AnswerValue> {
  const sender=await publicSender(ctx,"gallery.report");
  const fields=inputSchema.safeParse(input);
  if(!fields.success)return refusal("invalid_input");
  const proof=proofSchema.safeParse(input.humanCheck);
  if(!proof.success)return refusal("human_check_failed");
  const now=ctx.clock.now();
  try {
    return await ctx.db.transaction(async tx=>{
      const checked=await ctx.humanCheck.redeem(tx,proof.data,now);
      if(!checked.ok)throw new Answer(refusal("human_check_failed"));
      if(input.website || +now-+checked.issuedAt<3000) throw new Answer({ok:true});
      const allowance=await takeFormAllowance(tx,{form:"gallery_report",rules:[{scope:"ip",key:ipNetwork(sender.ip),max:await readSetting(tx,"gallery.reportsPerIpPerHour"),windowMs:3600000}],now,hash:formKeyedHash(ctx)});
      if(!allowance.ok)throw new Answer({ok:false,error:"rate_limited",retryAfter:allowance.retryAfter});
      const [row]=await tx.select().from(galleryItem).where(eq(galleryItem.id,fields.data.itemId)).for("update");
      if(!row || !await liveGallerySource({...ctx,db:tx},row))throw new Answer(refusal("not_found"));
      const id=uuidv7(now);
      await tx.insert(galleryReport).values({id,itemId:row.id,reason:fields.data.reason,detailsCiphertext:fields.data.details?ctx.cipher.encrypt("gallery_report.details",fields.data.details):null,contactCiphertext:fields.data.contact?ctx.cipher.encrypt("gallery_report.contact",fields.data.contact):null,status:"open",createdAt:now});
      await recordAudit(tx,{clock:ctx.clock,actor:{kind:"visitor",meta:sender}},{action:"gallery.reported",entity:{type:"gallery_report",id},before:null,after:{itemId:row.id,reason:fields.data.reason},actorRole:null},{withoutRequestMeta:true});
      await emit(tx,ctx.clock,{type:"gallery.reported",aggregate:{type:"gallery_report",id},payload:{reportId:id}});
      return {ok:true};
    });
  }catch(error){if(error instanceof Answer)return error.value;throw error;}
}
export async function listGalleryReports(ctx:UseCaseContext) {
  await authorize(ctx,"gallery.curate");
  const rows=await ctx.db.select({report:galleryReport,title:galleryItem.title,itemStatus:galleryItem.status}).from(galleryReport).innerJoin(galleryItem,eq(galleryReport.itemId,galleryItem.id)).orderBy(desc(galleryReport.createdAt));
  return rows.map(({report,title,itemStatus})=>({reportId:report.id,itemId:report.itemId,reason:report.reason,status:report.status,title,itemStatus,createdAt:report.createdAt,details:report.detailsCiphertext?ctx.cipher.decrypt("gallery_report.details",report.detailsCiphertext):null,contact:report.contactCiphertext?ctx.cipher.decrypt("gallery_report.contact",report.contactCiphertext):null}));
}
export async function dismissGalleryReport(ctx:UseCaseContext,input:{reportId:string}) {
  const {role}=await authorize(ctx,"gallery.curate");
  if(!z.uuid().safeParse(input.reportId).success)return refusal("not_found");
  return ctx.db.transaction(async tx=>{
    const [row]=await tx.update(galleryReport).set({status:"dismissed",handledAt:ctx.clock.now(),handledByUserId:ctx.actor.kind==="user"?ctx.actor.userId:null}).where(and(eq(galleryReport.id,input.reportId),eq(galleryReport.status,"open"))).returning({id:galleryReport.id});
    if(!row)return refusal("invalid_transition");
    await recordAudit(tx,ctx,{action:"gallery.report_dismissed",entity:{type:"gallery_report",id:row.id},before:{status:"open"},after:{status:"dismissed"},actorRole:role});
    return {ok:true} as const;
  });
}

/** Script-free form fallback: issue at most three solved challenges per
 * network per hour, before doing the bounded work on the server. The proof
 * still expires, is single-use and goes through the same submit allowance. */
export async function issueGalleryPlainProof(ctx:UseCaseContext) {
  const sender=await publicSender(ctx,"gallery.report");
  const now=ctx.clock.now();
  const allowance=await takeFormAllowance(ctx.db,{form:"gallery_plain_challenge",rules:[{scope:"ip",key:ipNetwork(sender.ip),max:3,windowMs:3600000}],now,hash:formKeyedHash(ctx)});
  if(!allowance.ok)return null;
  const challenge=await ctx.humanCheck.challenge(now);
  const {createHash}=await import("node:crypto");
  const {leadingZeroBits}=await import("../../../lib/proof-of-work");
  // Bound CPU for the fallback. The default 16-bit difficulty has a very
  // high probability of a solution within this fixed work allowance.
  if(challenge.difficulty>16)return null;
  for(let nonce=0;nonce<2**20;nonce++) {
    if(leadingZeroBits(createHash("sha256").update(`${challenge.salt}:${nonce}`).digest())>=challenge.difficulty)return {token:challenge.token,nonce};
  }
  return null;
}
