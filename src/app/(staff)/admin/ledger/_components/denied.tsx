import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";

import { LedgerFrame } from "./frame";

export async function LedgerDenied({ title }: { title: string }) {
  const [t, admin] = await Promise.all([
    getTranslations("adminLedger"),
    getTranslations("admin.denied"),
  ]);
  return (
    <LedgerFrame title={title}>
      <ExplainState
        title={t("deniedTitle")}
        back={{ href: APP_ROUTES.dashboard, label: admin("back") }}
      >
        <p>{t("denied")}</p>
      </ExplainState>
    </LedgerFrame>
  );
}
