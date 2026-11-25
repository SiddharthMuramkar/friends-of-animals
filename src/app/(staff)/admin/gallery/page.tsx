import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink,buttonStyles } from "@/components/site/button-link";
import { as,currentActor } from "@/server/app";
import { APP_ROUTES } from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";
import { galleryAction } from "./actions";
export const instant=false;
export const metadata={title:"Gallery curation",robots:{index:false,follow:false}};
const inputStyles="min-h-12 w-full min-w-0 rounded-xl border-2 border-border-strong bg-background p-3 text-ink";
export default async function Page({searchParams}:PageProps<"/admin/gallery">){
 const [actor,t,query]=await Promise.all([currentActor(),getTranslations("gallery.admin"),searchParams]);
 const loaded=await adminCall(async()=>Promise.all([as(actor).listGalleryCandidates(),as(actor).listGalleryItemsForAdmin()]),APP_ROUTES.adminGallery);
 return <Section width="wide" hue="pink" className="pt-10 sm:pt-14"><PageHeader title={t("title")} lead={t("lead")}/>{!loaded.ok?<AdminDenied/>:<>
  <ButtonLink href={APP_ROUTES.adminGalleryReports} className="mt-5">{t("reports")}</ButtonLink>
  {query.result?<p role="status" className="mt-4 text-ink">{t(query.result==="ok"?"saved":"error")}</p>:null}
  <h2 className="mt-8 text-h3 text-ink">{t("items")}</h2>
  {loaded.value[1].length===0?<p className="mt-4">{t("empty")}</p>:null}
  <ul className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-2">{loaded.value[1].map(item=><li key={item.itemId} className="min-w-0 rounded-2xl border-2 border-border bg-surface p-5">
    <h3 className="text-h4 text-ink wrap-anywhere">{item.title}</h3><p className="mt-2 text-ink">{item.entryCode} · {t(`status.${item.status}`)}</p>
    <p className="mt-2 text-sm text-ink">{t(item.stampReady?"ready":"pending")}</p>
    {item.credit?<p className="mt-2">{t("approvedCredit",{name:[item.credit.name,item.credit.school,item.credit.city].filter(Boolean).join(" · ")})}</p>:null}
    {item.stampReady?<Image src={`/api/admin/gallery/${item.itemId}/image`} alt={item.title} unoptimized width={800} height={500} className="mt-4 h-auto w-full rounded-xl"/>:null}
    {item.status==="draft"?<><p className="mt-4 text-ink-muted">{t("review")}</p><form action={galleryAction.bind(null,"edit",item.itemId)} className="mt-4 grid gap-3">
      <label htmlFor={`title-${item.itemId}`}>{t("titleLabel")}</label><input id={`title-${item.itemId}`} name="title" required maxLength={120} defaultValue={item.title} className={inputStyles}/>
      <label htmlFor={`story-${item.itemId}`}>{t("story")}</label><textarea id={`story-${item.itemId}`} name="story" maxLength={500} defaultValue={item.story} className={inputStyles} rows={4}/>
      <label className="flex items-center gap-2"><input name="featured" type="checkbox" defaultChecked={item.featured}/>{t("featured")}</label>
      <button type="submit" className={buttonStyles({variant:"secondary"})}>{t("save")}</button>
    </form><form action={galleryAction.bind(null,"publish",item.itemId)} className="mt-3"><button disabled={!item.reviewed||!item.stampReady||!item.eligible} className={buttonStyles()}>{t("publish")}</button></form></>:null}
    {item.status==="published"?<form action={galleryAction.bind(null,"hide",item.itemId)} className="mt-4"><button className={buttonStyles({variant:"secondary"})}>{t("hide")}</button></form>:null}
    {item.status==="hidden"?<form action={galleryAction.bind(null,"restore",item.itemId)} className="mt-4"><button className={buttonStyles({variant:"secondary"})}>{t("restore")}</button></form>:null}
  </li>)}</ul>
  <h2 className="mt-8 text-h3 text-ink">{t("candidates")}</h2>
  <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">{loaded.value[0].map(candidate=><li key={candidate.entryId} className="rounded-xl border border-border bg-surface p-4 min-w-0"><h3 className="font-semibold wrap-anywhere">{candidate.title}</h3><p className="text-sm">{candidate.entryCode}</p>{candidate.eligible?<form action={galleryAction.bind(null,"pick",candidate.entryId)} className="mt-3"><button className={buttonStyles({variant:"secondary"})}>{t("pick",{title:candidate.title})}</button></form>:<p className="mt-2 text-ink-muted">{t("notEligible",{reason:candidate.reason?t(`reasons.${candidate.reason}`):""})}</p>}</li>)}</ul>
 </>}</Section>;
}
