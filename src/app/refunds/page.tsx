import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { StubPage } from "@/components/site/stub-page";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

// Stub: the page's own task replaces this body.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("refunds.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.refunds.path,
  });
}

export default async function Page() {
  const t = await getTranslations("refunds.meta");
  return (
    <StubPage
      title={t("title")}
      description={t("description")}
      hue={ROUTES.refunds.hue}
    />
  );
}
