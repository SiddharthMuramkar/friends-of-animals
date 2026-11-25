import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../../../competitions/_lib/public-reader";
import { ReportForm } from "./_form";
export function generateStaticParams() {
  return [{ itemId: "__placeholder__" }];
}
export const metadata = {
  title: "Report gallery artwork",
  robots: { index: false, follow: false },
};
import { reportLabels } from "./labels";
async function Report({
  params,
  searchParams,
}: PageProps<"/gallery/[itemId]/report">) {
  await connection();
  const [{ itemId }, query, t, labels] = await Promise.all([
    params,
    searchParams,
    getTranslations("gallery"),
    reportLabels(),
  ]);
  const item = await as(PUBLIC_READER).getPublicGalleryItem({ itemId });
  if (!item) notFound();
  if (query.result === "sent")
    return (
      <p role="status" className="mt-6 text-lead text-ink">
        {t("sent")}
      </p>
    );
  return (
    <>
      <h2 className="mt-6 text-h3 text-ink">{item.title}</h2>
      {query.result ? (
        <p role="alert" className="mt-3">
          {t(query.result === "rate_limited" ? "rate_limited" : "invalid")}
        </p>
      ) : null}
      <ReportForm itemId={itemId} labels={labels} />
      <a
        className={buttonStyles({ variant: "quiet", className: "mt-5" })}
        href={`/gallery/${itemId}`}
      >
        {t("back")}
      </a>
    </>
  );
}
export default async function Page(
  props: PageProps<"/gallery/[itemId]/report">
) {
  const t = await getTranslations("gallery");
  return (
    <Section hue="pink" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("reportTitle")} lead={t("reportLead")} />
      <Suspense fallback={<p className="mt-5">{t("loading")}</p>}>
        <Report {...props} />
      </Suspense>
      <a
        className={buttonStyles({ variant: "quiet", className: "mt-4" })}
        href="report/plain"
      >
        {t("simple")}
      </a>
    </Section>
  );
}
