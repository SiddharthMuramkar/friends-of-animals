// Auction credit and current evidence: an adult's own consent, or a minor's
// verified guardian's current consent. The cap is based on age at entry as
// well as now, so turning 18 cannot expose a child's original full name.
import { and, desc, eq } from "drizzle-orm";
import { consentEvent, guardian, guardianLink, participantProfile, registration } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { childDateOfBirth } from "../guardians/child-view";
import { activeLinkOf, verifiedLink } from "../guardians/child-access";
import { isAdultAt } from "../participants/domain/age";
import { competitionSetup } from "./child-consent";
import { nameParts, resolvePublicCredit } from "./domain/public-credit";
import { lockProfileSubject, lockUserSubject } from "./repository";
import { schoolPublicConsents } from "./school-route-use";

export async function auctionConsentCredit(ctx: Pick<UseCaseContext,"db"|"cipher"|"clock">, registrationId: string, lock=false) {
  async function read(){return ctx.db.select({ profile:participantProfile, registration }).from(registration)
    .innerJoin(participantProfile, eq(participantProfile.id,registration.participantProfileId))
    .where(eq(registration.id,registrationId));}
  let [row]=await read();
  if(lock && row){await lockProfileSubject(ctx.db,row.profile.id); [row]=await read();}
  if(!row || !["confirmed","enrolled"].includes(row.registration.status)) return null;
  const {profile, registration: reg} = row;
  const setup = await competitionSetup(ctx.db,reg.competitionId);
  const document = setup?.setup.attached.auction;
  if (!setup?.setup.auctionAllowed || !document) return null;
  const dob = childDateOfBirth(ctx, profile).date;
  const minor = !isAdultAt(dob,ctx.clock.now());
  const cap = minor || !isAdultAt(dob,reg.createdAt);
  const creatorUserId = profile.ownerKind === "self" ? profile.ownerUserId : profile.loginUserId;
  const subjectId = minor ? profile.id : creatorUserId;
  if(!subjectId) return null;
  if(lock && !minor) await lockUserSubject(ctx.db,subjectId);
  const subjectType = minor ? "participant_profile" : "user";
  const [latest] = await ctx.db.select().from(consentEvent).where(and(
    eq(consentEvent.subjectType,subjectType), eq(consentEvent.subjectId,subjectId),
    eq(consentEvent.competitionId,reg.competitionId), eq(consentEvent.purpose,"auction")
  )).orderBy(...(minor?[desc(consentEvent.id)]:[desc(consentEvent.occurredAt),desc(consentEvent.id)])).limit(1);
  if(!latest || latest.action !== "given" || latest.documentId !== document.id) return null;
  if (!minor) {
    if(latest.giverUserId !== creatorUserId || latest.method !== "web_form") return null;
  } else if (profile.ownerKind === "institution") {
    // School-route consent is verified evidence from an OTP link or
    // accepted signed form, never the school's participation declaration.
    if (reg.route !== "institution") return null;
    const evidence = await schoolPublicConsents(ctx.db,{ profileIds:[profile.id], competitionId:reg.competitionId, offers:[{purpose:"auction",id:document.id}]});
    if(evidence.get(profile.id)?.[0]?.status !== "given") return null;
  } else {
    if(latest.method !== "web_form" || !latest.giverUserId) return null;
    const [live] = await ctx.db.select({id:guardianLink.id}).from(guardianLink)
      .innerJoin(guardian,eq(guardianLink.guardianId,guardian.id))
      .where(and(activeLinkOf(latest.giverUserId, profile.id),verifiedLink())).limit(1);
    if(!live) return null;
  }
  const credit = resolvePublicCredit({...nameParts(profile.fullName),fullName:profile.fullName,minor:cap},"auction",new Set(["auction"]));
  if(!credit) return null;
  return {credit, minor, subjectType, subjectId, consentEventId:latest.id};
}
