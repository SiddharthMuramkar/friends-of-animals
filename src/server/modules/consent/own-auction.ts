// The adult creator's auction consent is recorded at registration. They
// can withdraw their own competition-scoped consent even if the competition
// has ended or FOA changes its terms; the withdrawal never needs a new pin.
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { competition, consentEvent } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { invalidInput } from "../../input";
import { lockUserSubject, subjectEvents } from "./repository";
import { currentConsent, decideWithdraw } from "./domain/consent-state";
import { appendConsentEvent } from "./consents";

export async function myAuctionConsents(ctx:UseCaseContext){
  await authorize(ctx,"consent.view_own");
  if(ctx.actor.kind!=="user") throw new Error("Expected user");
  const rows=await ctx.db.selectDistinctOn([consentEvent.competitionId],{competitionId:competition.id,title:competition.name,
    state:consentEvent.action}).from(consentEvent).innerJoin(competition,eq(competition.id,consentEvent.competitionId))
    .where(and(eq(consentEvent.subjectType,"user"),eq(consentEvent.subjectId,ctx.actor.userId),
      eq(consentEvent.giverUserId,ctx.actor.userId),eq(consentEvent.purpose,"auction"),isNotNull(consentEvent.competitionId)))
    .orderBy(consentEvent.competitionId,desc(consentEvent.occurredAt),desc(consentEvent.id));
  return rows;
}

export async function withdrawMyAuctionConsent(ctx:UseCaseContext,input:{competitionId:string}){
  await authorize(ctx,"consent.withdraw");
  if(ctx.actor.kind!=="user") throw new Error("Expected user");
  const userId=ctx.actor.userId;
  const parsed=z.object({competitionId:z.uuid()}).safeParse(input);
  if(!parsed.success) return invalidInput(parsed.error);
  const subject={type:"user" as const,id:userId};
  return ctx.db.transaction(async tx=>{
    await lockUserSubject(tx,userId);
    const state=currentConsent(await subjectEvents(tx,subject,"auction",parsed.data.competitionId,userId));
    const decision=decideWithdraw(state);
    if(decision.kind!=="record") return {ok:true,changed:false} as const;
    await appendConsentEvent(tx,ctx,state,{subject,giverUserId:userId,purpose:"auction",action:"withdrawn",documentId:decision.documentId,method:"web_form",competitionId:parsed.data.competitionId});
    return {ok:true,changed:true} as const;
  });
}
