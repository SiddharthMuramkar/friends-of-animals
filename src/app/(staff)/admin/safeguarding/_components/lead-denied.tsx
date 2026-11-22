import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";

/**
 * What anyone but a safeguarding lead sees on the lead's pages: the use
 * case refused, so there is nothing of a report to show. Super admins
 * included (#116). A page never calls forbidden(): authInterrupts is off.
 * `headingLevel` is "h1" on a page with no heading of its own.
 */
export async function LeadDenied({
  headingLevel = "h2",
}: {
  headingLevel?: "h1" | "h2";
}) {
  const t = await getTranslations("adminSafeguarding.denied");
  return (
    <ExplainState
      title={t("title")}
      headingLevel={headingLevel}
      back={{ href: APP_ROUTES.dashboard, label: t("back") }}
      className="mt-8"
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}
