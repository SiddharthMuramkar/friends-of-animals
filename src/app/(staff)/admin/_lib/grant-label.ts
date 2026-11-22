import type { getTranslations } from "next-intl/server";

import type { Grant } from "@/server/access";

type AdminTranslator = Awaited<ReturnType<typeof getTranslations<"admin">>>;

/** A grant in words: "Judge, everywhere", "Institution coordinator for institution <id>". */
export function grantLabel(t: AdminTranslator, grant: Grant): string {
  const role = t(`roles.${grant.role}`);
  return grant.scope.type === "global"
    ? t("grant.global", { role })
    : t("grant.scoped", { role, scope: grant.scope.type, id: grant.scope.id });
}
