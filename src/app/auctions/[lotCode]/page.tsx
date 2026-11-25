import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { ButtonLink } from "@/components/site/button-link";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../../competitions/_lib/public-reader";
import { LotDetails } from "../_lot-details";

// A minor's lot detail must not be indexed: its consent can change at any time.
export const instant=false;
export async function generateMetadata():Promise<Metadata>{
  const t=await getTranslations("auctions");
  return {title:t("title"),robots:{index:false,follow:false}};
}
export default async function Page({params}:PageProps<"/auctions/[lotCode]">){
  await connection();
  const {lotCode}=await params;
  const [t,lot]=await Promise.all([getTranslations("auctions"),as(PUBLIC_READER).getLot({lotCode})]);
  if(!lot) notFound();
  return <Section hue="yellow" tone="tint" className="pt-10 sm:pt-14">
    <ButtonLink href="/auctions" variant="quiet">{t("back")}</ButtonLink>
    <PageHeader title={t("lot",{code:lot.lotCode})} className="mt-5"/>
    <article className="mt-8 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6">
      <LotDetails lot={lot}/>
    </article>
  </Section>;
}
