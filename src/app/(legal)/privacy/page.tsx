import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { LEGAL_PAGE_PURPOSE } from "@/server/consent/domain/purposes";

import { LegalDocument } from "../_components/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.privacy.path,
  });
}

export default function Page() {
  return <LegalDocument id="privacy" purpose={LEGAL_PAGE_PURPOSE.privacy} />;
}
