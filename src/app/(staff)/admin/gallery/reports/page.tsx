import { getTranslations,getFormatter } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink,buttonStyles } from "@/components/site/button-link";
import { as,currentActor } from "@/server/app";
import { APP_ROUTES } from "@/lib/app-routes";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { galleryAction } from "../actions";
export const instant=false;
export const metadata={title:"Gallery reports",robots:{index:false,follow:false}};
export default async function Page({searchParams}:PageProps<"/admin/gallery/reports">){
 const [actor,t,reportText,format,query]=await Promise.all([currentActor(),getTranslations("gallery.admin"),getTranslations("gallery"),getFormatter(),searchParams]);
 const loaded=await adminCall(()=>as(actor).listGalleryReports(),APP_ROUTES.adminGalleryReports);
 return <Section hue="pink" className="pt-10 sm:pt-14"><PageHeader title={t("reports")} lead={t("reportLead")}/>{!loaded.ok?<AdminDenied/>:<>
 <ButtonLink href={APP_ROUTES.adminGallery} variant="quiet" className="mt-4">{t("title")}</ButtonLink>
 {query.result?<p role="status" className="mt-3">{t(query.result==="ok"?"saved":"error")}</p>:null}
 {loaded.value.length===0?<p className="mt-5">{t("empty")}</p>:null}
 <ul className="mt-6 grid gap-4">{loaded.value.map(report=><li key={report.reportId} className="rounded-2xl border-2 border-border bg-surface p-5 min-w-0 wrap-anywhere"><h2 className="text-h4 text-ink">{report.title}</h2><p className="mt-2 font-semibold">{reportText(`reasons.${report.reason}`)} · {t(`status.${report.status}`)}</p><p className="text-sm text-ink-muted">{format.dateTime(report.createdAt,"longDateTime")}</p>{report.details?<p className="mt-3 whitespace-pre-line">{report.details}</p>:null}{report.contact?<p className="mt-3">{report.contact}</p>:null}
 {report.status==="open"?<div className="mt-4 flex flex-wrap gap-2">{report.itemStatus==="published"?<form action={galleryAction.bind(null,"hide",report.itemId)}><input type="hidden" name="from" value="reports"/><button className={buttonStyles()}>{t("hide")}</button></form>:null}<form action={galleryAction.bind(null,"dismiss",report.reportId)}><button className={buttonStyles({variant:"secondary"})}>{t("dismiss")}</button></form></div>:null}</li>)}</ul>
 </>}</Section>;
}
