import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { ROUTES } from "@/lib/routes";

/**
 * Why someone who isn't a content manager sees no templates. (Staff short
 * of their second step are sent to enter it instead, #60.)
 */
export async function Denied({ className }: { className?: string }) {
  const t = await getTranslations("adminTemplates");
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
