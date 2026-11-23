import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";

/**
 * What a signed-in person sees on an admin page their roles don't open:
 * the use case refused, so there is no data to show. A page never calls
 * forbidden(): authInterrupts is off.
 */
export async function AdminDenied() {
  const t = await getTranslations("admin.denied");
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
