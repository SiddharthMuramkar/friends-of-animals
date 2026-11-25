import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
import { as,currentActor } from "@/server/app";
import { PUBLIC_READER } from "../../../competitions/_lib/public-reader";
import { ReportFields,ReportForm } from "./_form";
import { sendGalleryReport } from "./actions";
export function generateStaticParams(){return [{itemId:"__placeholder__"}];}
export const metadata={title:"Report gallery artwork",robots:{index:false,follow:false}};
async function Report({params,searchParams}:PageProps<"/gallery/[itemId]/report">){
 await connection();
 const [{itemId},query,t]=await Promise.all([params,searchParams,getTranslations("gallery")]);
 const item=await as(PUBLIC_READER).getPublicGalleryItem({itemId});
 if(!item)notFound();
 const labels={reason:t("reportReason"),details:t("details"),contact:t("contact"),send:t("send"),sending:t("sending"),invalid:t("invalid"),reasons:(["identifies_child","inappropriate_content","wrong_credit","other"] as const).map(value=>({value,label:t(`reasons.${value}`)}))};
 if(query.result==="sent")return <p role="status" className="mt-6 text-lead text-ink">{t("sent")}</p>;
 const plain=query.plain==="1";
 const proof=plain?await as(await currentActor()).issueGalleryPlainProof():null;
 return <><h2 className="mt-6 text-h3 text-ink">{item.title}</h2>{query.result?<p role="alert" className="mt-3">{t(query.result==="rate_limited"?"rate_limited":"invalid")}</p>:null}
 {plain?(proof?<form action={sendGalleryReport.bind(null,itemId)} className="mt-6 grid max-w-xl gap-3"><ReportFields labels={labels}/><input type="hidden" name="plain" value="1"/><input type="hidden" name="humanCheckToken" value={proof.token}/><input type="hidden" name="humanCheckNonce" value={proof.nonce}/><button className={buttonStyles()}>{labels.send}</button></form>:<p className="mt-4">{t("plainUnavailable")}</p>):<><ReportForm itemId={itemId} labels={labels}/><noscript><p className="mt-4">{t("noScript")} <a className="underline" href={`/gallery/${itemId}/report?plain=1`}>{t("simple")}</a></p></noscript></>}
 <a className={buttonStyles({variant:"quiet",className:"mt-5"})} href={`/gallery/${itemId}`}>{t("back")}</a></>;
}
export default async function Page(props:PageProps<"/gallery/[itemId]/report">){const t=await getTranslations("gallery");return <Section hue="pink" tone="tint" className="pt-10 sm:pt-14"><PageHeader title={t("reportTitle")} lead={t("reportLead")}/><Suspense fallback={<p className="mt-5">{t("loading")}</p>}><Report {...props}/></Suspense></Section>;}
