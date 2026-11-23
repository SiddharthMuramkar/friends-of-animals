import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";

export async function GuardianSetupUnavailable({
  back,
}: {
  back?: { href: string; label: string };
}) {
  const t = await getTranslations("guardian.setupUnavailable");
  return (
    <ExplainState
      className="mt-8"
      title={t("title")}
      back={back ?? { href: APP_ROUTES.dashboard, label: t("back") }}
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}
