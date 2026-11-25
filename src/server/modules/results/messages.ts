import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { competition, entry, participantProfile, registration, resultAward, resultRelease } from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { guardianLinksByProfile } from "../guardians/participant-audience";
import { isAdultAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { familyContactEmail } from "../registration/confirmation-message";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import type { AwardBand } from "../competitions/domain/award-schemes";

export const PRIZE_VARIABLES=["participant.name","competition.name","award.name","award.prize","award.delivery"] as const;
const bandLabels:Record<AwardBand,string>={first:"First place",second:"Second place",third:"Third place",gold:"Gold",silver:"Silver",bronze:"Bronze",grade_a:"Grade A",grade_b:"Grade B"};
type PrizePayload=Delivery<"results.prize_awarded">["payload"];
// Revalidate the immutable release, exact entry and current confirmed registration.
async function prizeFacts(db:AppDb,p:PrizePayload){
  const [row]=await db.select({awardBand:resultAward.awardBand,prize:resultAward.prize,deliveryNote:resultRelease.deliveryNote,competitionName:competition.name,profileId:participantProfile.id,participantName:participantProfile.fullName,route:registration.route,registeredAt:registration.createdAt,ownerKind:participantProfile.ownerKind,ownerUserId:participantProfile.ownerUserId,dob:participantProfile.dobCiphertext,guardianName:participantProfile.guardianNameCiphertext,guardianEmail:participantProfile.guardianEmailCiphertext}).from(resultAward)
    .innerJoin(resultRelease,eq(resultRelease.id,resultAward.releaseId))
    .innerJoin(competition,eq(competition.id,resultRelease.competitionId))
    .innerJoin(entry,eq(entry.id,resultAward.entryId))
    .innerJoin(registration,eq(registration.id,entry.registrationId))
    .innerJoin(participantProfile,eq(participantProfile.id,registration.participantProfileId))
    .where(and(eq(resultRelease.id,p.releaseId),eq(resultRelease.status,"published"),eq(competition.id,p.competitionId),eq(competition.status,"results_published"),eq(entry.id,p.entryId),eq(registration.id,p.registrationId),eq(registration.status,"confirmed")));
  return row?.awardBand ? row : null;
}
export async function prizeValues(db:AppDb,p:PrizePayload):Promise<Record<string,string>>{
  const row=await prizeFacts(db,p);
  if(!row?.awardBand) return {};
  return {"participant.name":row.participantName,"competition.name":row.competitionName,"award.name":bandLabels[row.awardBand],"award.prize":row.prize??bandLabels[row.awardBand],"award.delivery":row.deliveryNote};
}
/** Individual confirmations are consent/guardian gated. Never route a
 * guardian-managed child's prize to their own login, including inbox. */
export async function prizeRecipients(db:AppDb,p:PrizePayload){
  const row=await prizeFacts(db,p);
  if(!row || row.route!=="individual") return [];
  const links=(await guardianLinksByProfile(db,[row.profileId])).get(row.profileId)??[];
  const guardians=links.filter(l=>l.verified&&!l.revoked).map(l=>l.userId);
  return row.ownerKind==="guardian" ? [...new Set(guardians)] : row.ownerKind==="self"&&row.ownerUserId ? [row.ownerUserId] : [];
}
export async function sendFamilyPrize(deps:OutboxDeps,delivery:Delivery<"results.prize_awarded">){
  const row=await prizeFacts(deps.db,delivery.payload);
  if(!row || row.route!=="institution" || !row.dob) return;
  const dob=parseIsoDate(deps.cipher.decrypt(PROFILE_PURPOSE.dob,row.dob));
  if(!dob) return;
  // Never let the family helper fall back to a minor's own address.
  if(!isAdultAt(dob,row.registeredAt)&&(!row.guardianName||!row.guardianEmail)) return;
  const message=await familyContactEmail(deps,{eventType:delivery.eventType,registrationId:delivery.payload.registrationId,sendWhile:s=>s==="confirmed",values:()=>prizeValues(deps.db,delivery.payload)});
  if(message) await deps.email.send(message,{deliveryId:delivery.id});
}
