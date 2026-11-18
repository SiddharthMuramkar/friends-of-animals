import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { StubPage } from "@/components/site/stub-page";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { isSampleContentEnabled } from "@/lib/site";

// Stub: the page's own task replaces this body.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("styleguide.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.styleguide.path,
  });
}

export default async function Page() {
  // Test sites only.
  if (!isSampleContentEnabled()) notFound();
  const t = await getTranslations("styleguide.meta");
  return (
    <StubPage
      title={t("title")}
      description={t("description")}
      hue={ROUTES.styleguide.hue}
    />
  );
}
