import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { ADMIN_BREACHES, APP_ROUTES } from "@/lib/app-routes";

export async function BreachAccessState({
  state,
}: {
  state: "denied" | "missing";
}) {
  const t = await getTranslations("adminBreaches");
  const back =
    state === "denied"
      ? { href: APP_ROUTES.dashboard, label: t("denied.back") }
      : { href: ADMIN_BREACHES, label: t("back") };
  return (
    <ExplainState title={t(`${state}.title`)} headingLevel="h1" back={back}>
      <p>{t(`${state}.body`)}</p>
    </ExplainState>
  );
}
