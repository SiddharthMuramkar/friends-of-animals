import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";

/**
 * What anyone the refunds use cases refuse sees on the refund pages
 * (#80): there is nothing to show. A page never calls forbidden():
 * authInterrupts is off. `headingLevel` is "h1" on a page with no heading
 * of its own.
 */
export async function RefundsDenied({
  headingLevel = "h2",
}: {
  headingLevel?: "h1" | "h2";
}) {
  const t = await getTranslations("adminRefunds.denied");
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
