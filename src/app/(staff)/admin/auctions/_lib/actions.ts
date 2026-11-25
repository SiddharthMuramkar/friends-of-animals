"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { adminAuctionLotPath, ADMIN_AUCTIONS_NEW } from "@/lib/app-routes";
import { adminCall } from "../../_lib/boundary";

const rupees=(value:FormDataEntryValue|null)=>{
  if(typeof value!=="string" || !/^\d{1,17}(\.\d{1,2})?$/.test(value)) return -1n;
  const [whole,pennies=""]=value.split(".");
  return BigInt(whole!)*100n+BigInt(pennies.padEnd(2,"0"));
};
const ist=(value:FormDataEntryValue|null)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)?new Date(value+":00+05:30"):new Date(NaN);

export async function createAuctionLot(form:FormData){
  const result=await adminCall(async()=>as(await currentActor()).createLot({
    artworkId:String(form.get("artworkId")??""),story:String(form.get("story")??""),
    basePricePaise:rupees(form.get("base")),reservePricePaise:rupees(form.get("reserve")),
    opensAt:ist(form.get("opensAt")),closesAt:ist(form.get("closesAt")),
  }),ADMIN_AUCTIONS_NEW);
  if(result.ok && result.value.ok) redirect(adminAuctionLotPath(result.value.lotId));
  redirect(ADMIN_AUCTIONS_NEW+"?result=error");
}
export async function scheduleAuctionLot(lotId:string){
  const path=adminAuctionLotPath(lotId);
  const result=await adminCall(async()=>as(await currentActor()).scheduleLot({lotId}),path);
  redirect(path+"?result="+(result.ok&&result.value.ok?"ok":result.ok&&result.value.error==="auctions_disabled"?"disabled":"error"));
}
export async function cancelAuctionLot(lotId:string,form:FormData){
  const path=adminAuctionLotPath(lotId);
  const result=await adminCall(async()=>as(await currentActor()).cancelLot({lotId,reason:String(form.get("reason")??"")}),path);
  redirect(path+"?result="+(result.ok&&result.value.ok?"ok":"error"));
}
