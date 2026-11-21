import { getTranslations } from "next-intl/server";

import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * The way to the phone form, under the email form, while SMS is on; while
 * it is off there is nothing to offer, so nothing shows. Reads the setting
 * per request: render it inside <Suspense>.
 */
export async function PhoneOption({
  intent,
}: {
  intent: "sign-up" | "sign-in";
}) {
  const [methods, t] = await Promise.all([
    currentActor().then((actor) => as(actor).signInMethods()),
    getTranslations("authPhone.option"),
  ]);
  if (!methods.phone) return null;
  const phone = intent === "sign-up" ? ROUTES.signUpPhone : ROUTES.signInPhone;
  return (
    <p className="mt-6">
      <SiteLink href={phone.path} className={LINK}>
        {intent === "sign-up" ? t("signUp") : t("signIn")}
      </SiteLink>
    </p>
  );
}
