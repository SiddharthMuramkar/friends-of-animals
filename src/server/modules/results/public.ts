import { and, eq } from "drizzle-orm";
import { authorize } from "../../access/can";
import { competition } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { COMPETITION_SLUG_PATTERN } from "../competitions/domain/slug";
import { publicUse } from "../consent";
import { publishedResults } from "./read-published";

export async function getPublicResults(ctx: UseCaseContext, {slug}:{slug:string}) {
  await authorize(ctx,"results.public_read");
  if (!COMPETITION_SLUG_PATTERN.test(slug)) return null;
  const [c]=await ctx.db.select({id:competition.id,name:competition.name,slug:competition.slug}).from(competition).where(and(eq(competition.slug,slug),eq(competition.status,"results_published")));
  if(!c) return null;
  const release=await publishedResults(ctx.db,c.id);
  if(!release) return null;
  // No cache and no identifying placeholder for withheld recognition. Only
  // live, purpose-specific consent can put an award on the public page.
  const awards=[];
  for(const line of release.lines){
    const credit=await publicUse(ctx,{profileId:line.participantProfileId,competitionId:c.id,use:"results"});
    if(credit) awards.push({discipline:line.discipline,category:line.categoryLabel,outcome:line.outcome,awardBand:line.awardBand,credit});
  }
  return {competitionName:c.name,slug:c.slug,publishedAt:release.publishedAt,awards};
}
