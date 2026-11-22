import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { AuthPage } from "../_components/auth-page";
import { MessagesConsentField } from "../_components/messages-consent-field";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signUp.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.signUp.path,
  });
}

export default function Page() {
  return (
    <AuthPage
      intent="sign-up"
      consentField={
        // The current messages consent text comes from the database at
        // request time; the rest of the page is prerendered.
        <Suspense fallback={null}>
          <MessagesConsentField />
        </Suspense>
      }
    />
  );
}
