import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { LegalDocument } from "../_components/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.childProtection.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.childProtection.path,
  });
}

export default function Page() {
  return <LegalDocument id="childProtection" />;
}
