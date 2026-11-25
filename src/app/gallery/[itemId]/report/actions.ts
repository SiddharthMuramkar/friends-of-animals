"use server";
import { redirect } from "next/navigation";
import { as,currentActor } from "@/server/app";
const text=(form:FormData,key:string)=>String(form.get(key)??"");
export async function sendGalleryReport(itemId:string,form:FormData){
  const result=await as(await currentActor()).reportGalleryItem({itemId,reason:text(form,"reason"),details:text(form,"details"),contact:text(form,"contact"),website:text(form,"website"),humanCheck:{token:text(form,"humanCheckToken"),nonce:Number(text(form,"humanCheckNonce"))}});
  const outcome=result.ok?"sent":result.error==="rate_limited"?"rate_limited":"invalid";
  redirect(`/gallery/${encodeURIComponent(itemId)}/report?result=${outcome}${form.get("plain") === "1" ? "&plain=1" : ""}`);
}
