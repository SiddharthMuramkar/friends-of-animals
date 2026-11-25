import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../competitions/_lib/public-reader";
import { ArtworkCards } from "./_artwork";
export async function generateMetadata(){ const t=await getTranslations("gallery");return {title:t("title"),description:t("lead"),robots:{index:false,follow:false}}; }
export default async function Page({searchParams}:PageProps<"/gallery">) {
  const t=await getTranslations("gallery");
  return <Section hue="pink" tone="tint" width="wide" className="pt-10 sm:pt-14">
    <PageHeader title={t("title")} lead={t("lead")}/>
    <Suspense fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}><Gallery searchParams={searchParams}/></Suspense>
  </Section>;
}
async function Gallery({searchParams}:Pick<PageProps<"/gallery">,"searchParams">) {
  await connection();
  const [query,t]=await Promise.all([searchParams,getTranslations("gallery")]);
  const filters = Object.fromEntries(["competition","discipline","category","recognition","cursor"].flatMap(k=>typeof query[k]==="string"&&query[k]?[ [k,query[k]] ]:[]));
  const page=await as(PUBLIC_READER).listPublicGallery(filters);
  const more=page.nextCursor? new URLSearchParams({...filters,cursor:page.nextCursor}).toString():null;
  return <section className="mt-8" aria-labelledby="gallery-stories"><h2 id="gallery-stories" className="text-h3 text-ink">{t("displayTitle")}</h2>
    <form method="get" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {([ ["competition","competition"], ["discipline","discipline"], ["category","filterCategory"], ["recognition","recognition"] ] as const).map(([key,label])=><div key={key} className="grid gap-1"><label htmlFor={`filter-${key}`} className="font-semibold text-sm">{t(label)}</label><input id={`filter-${key}`} name={key} defaultValue={filters[key]??""} className="min-h-12 min-w-0 rounded-xl border-2 border-border-strong bg-background px-3 text-ink"/></div>)}
      <button className={buttonStyles({variant:"secondary"})} type="submit">{t("filter")}</button><a href="/gallery" className={buttonStyles({variant:"quiet"})}>{t("clear")}</a>
    </form>
    <ArtworkCards items={page.items}/>
    {more?<a className={buttonStyles({variant:"secondary",className:"mt-6"})} href={`/gallery?${more}`}>{t("next")}</a>:null}
  </section>;
}
