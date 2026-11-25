import { SiteLink } from "@/components/site/site-link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { buttonStyles } from "@/components/site/button-link";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../../competitions/_lib/public-reader";
import { ArtworkDetails } from "../_artwork";
export function generateStaticParams() {
  return [{ itemId: "__placeholder__" }];
}
export async function generateMetadata() {
  const t = await getTranslations("gallery");
  return { title: t("displayTitle"), robots: { index: false, follow: false } };
}
async function Item({ params }: PageProps<"/gallery/[itemId]">) {
  await connection();
  const [{ itemId }, t] = await Promise.all([
    params,
    getTranslations("gallery"),
  ]);
  const item = await as(PUBLIC_READER).getPublicGalleryItem({ itemId });
  if (!item) notFound();
  return (
    <article className="mt-8 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 sm:p-6">
      <h2 className="text-h3 text-ink wrap-anywhere">{item.title}</h2>
      <ArtworkDetails item={item} priority />
      <SiteLink
        prefetch={false}
        className={buttonStyles({ variant: "quiet", className: "mt-4" })}
        href={`/gallery/${itemId}/report`}
      >
        {t("report")}
      </SiteLink>
    </article>
  );
}
export default async function Page(props: PageProps<"/gallery/[itemId]">) {
  const t = await getTranslations("gallery");
  return (
    <Section hue="pink" tone="tint" className="min-h-svh pt-10 sm:pt-14">
      <SiteLink
        prefetch={false}
        href="/gallery"
        className={buttonStyles({ variant: "quiet" })}
      >
        {t("back")}
      </SiteLink>
      <PageHeader
        className="mt-5"
        title={t("displayTitle")}
        lead={t("detailLead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Item {...props} />
      </Suspense>
    </Section>
  );
}
