import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import type { DomainErrorCode } from "@/server/errors";

/**
 * Why a refused actor sees no templates: they aren't a content manager, or
 * they are staff who haven't entered their second step this session (#60).
 */
export async function Refused({
  refusal,
  className,
}: {
  refusal: DomainErrorCode;
  className?: string;
}) {
  const t = await getTranslations("adminTemplates");
  if (refusal === "forbidden") {
    return (
      <ExplainState
        title={t("denied.title")}
        back={{ href: ROUTES.home.path, label: t("denied.back") }}
        className={className}
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }
  return (
    <ExplainState
      title={t("secondFactor.title")}
      back={{ href: APP_ROUTES.accountSessions, label: t("secondFactor.back") }}
      className={className}
    >
      <p>{t(`secondFactor.${refusal}`)}</p>
    </ExplainState>
  );
}
