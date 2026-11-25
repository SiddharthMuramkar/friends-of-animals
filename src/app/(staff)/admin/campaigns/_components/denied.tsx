import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { ADMIN_CAMPAIGNS, APP_ROUTES } from "@/lib/app-routes";

/** What an actor the policy refuses sees instead of a campaign page. */
export async function CampaignsDenied() {
  const t = await getTranslations("campaigns.admin.denied");
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

/** What a campaign id that matches nothing shows. */
export async function CampaignNotFound() {
  const t = await getTranslations("campaigns.admin.notFound");
  return (
    <ExplainState
      title={t("title")}
      back={{ href: ADMIN_CAMPAIGNS, label: t("back") }}
      className="mt-8"
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}
