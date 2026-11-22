import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";

/**
 * What anyone but a safeguarding lead sees on the lead's pages: the use
 * case refused, so there is nothing of a report to show. Super admins
 * included (#116). A page never calls forbidden(): authInterrupts is off.
 */
export async function LeadDenied() {
  const t = await getTranslations("adminSafeguarding.denied");
  return (
    <ExplainState
      title={t("title")}
      back={{ href: APP_ROUTES.dashboard, label: t("back") }}
      className="mt-8"
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}
