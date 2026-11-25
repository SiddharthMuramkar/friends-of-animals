import { type Harness } from "@/test/harness";
import { consentCompetition } from "../consent/testing";
import { confirmedAdult, confirmedChild, submittedImage } from "../entries/testing";
import { signedInWith, managerOf } from "../judging/testing";
import { conditionPhotos, verificationDetails } from "../physical-artwork/testing";
import { closeSubmissions, entryIdOf, signedInVerifier } from "../verification/testing";

export async function auctionArtwork(h:Harness,minor=false) {
  const competition=await consentCompetition(h,{fee:0n,physicalArtwork:{kind:"all_shortlisted"}});
  const artist=minor?await confirmedChild(h,{competition}):await confirmedAdult(h,{competition});
  const childId="childId" in artist?artist.childId as string:null;
  const code=await submittedImage(h,artist);
  await h.drain();
  const entryId=await entryIdOf(h, code);
  await closeSubmissions(h);
  const competitionId=competition.id;
  const manager=await signedInWith(h,managerOf(competitionId));
  const verifier=await signedInVerifier(h);
  const auctioneer=await signedInWith(h,{role:"auction_manager",scope:{type:"global"}});
  if(!(await h.as(verifier).verifyEntry({entryId})).ok)throw new Error("Entry not verified");
  const requested=await h.as(manager).requestPhysicalArtwork({competitionId,entryIds:[entryId]});
  if(!requested.ok) throw new Error("Artwork not requested");
  const {artworkId}=requested.artworks[0]!;
  if(!(await h.as(verifier).markArtworkReceived({artworkId})).ok) throw new Error("Receipt failed");
  const photos=await conditionPhotos(h,verifier,artworkId);
  if(!(await h.as(verifier).verifyArtwork({artworkId,...verificationDetails,photos})).ok)throw new Error("Verification failed");
  return {artist,competition,childId,artworkId,manager,verifier,auctioneer,
    input:()=>({artworkId,story:"A celebration of kindness",basePricePaise:10000n,reservePricePaise:20000n,
      opensAt:new Date(h.clock.now().getTime()+3600000),closesAt:new Date(h.clock.now().getTime()+7200000)})};
}
