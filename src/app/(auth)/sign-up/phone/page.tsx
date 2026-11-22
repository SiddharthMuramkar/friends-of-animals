import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { PhoneAuthPage } from "../../_components/phone-auth-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("authPhone.signUp.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.signUpPhone.path,
  });
}

export default function Page() {
  return <PhoneAuthPage intent="sign-up" />;
}
