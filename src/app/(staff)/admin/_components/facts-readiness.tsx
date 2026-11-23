import { getTranslations } from "next-intl/server";

import { Callout } from "@/components/site/callout";
import { SiteLink } from "@/components/site/site-link";
import { adminCmsDocumentPath, APP_ROUTES } from "@/lib/app-routes";
import type { PlaceholderKey } from "@/lib/site";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { TAX_FACT_KEYS } from "@/server/modules/cms/domain/org-facts";

const LINK =
  "font-semibold text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

function isTaxFact(key: PlaceholderKey): boolean {
  return TAX_FACT_KEYS.includes(key);
}

/**
 * Tells staff which of FOA's organisation facts are still missing (#111),
 * and where each is entered: the pages leave them out in production until
 * then, and /api/health says "incomplete". Shows nothing to anyone else,
 * or once every fact is in. Reads the session: render it in <Suspense>.
 */
export async function FactsReadiness() {
  const actor = await currentActor();
  if (actor.kind !== "user") return null;
  let missing: PlaceholderKey[];
  try {
    ({ missing } = await as(actor).orgFactsReadiness());
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
  if (missing.length === 0) return null;
  const [t, labels] = await Promise.all([
    getTranslations("admin.facts"),
    getTranslations("common.placeholders"),
  ]);
  const tax = missing.some(isTaxFact);
  const site = missing.some((key) => !isTaxFact(key));
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <Callout tone="warning" title={t("title")}>
        <p>{t("body")}</p>
        <ul className="list-disc pl-5">
          {missing.map((key) => (
            <li key={key}>{labels(key)}</li>
          ))}
        </ul>
        <ul className="flex flex-col gap-1">
          {site ? (
            <li>
              <SiteLink
                href={adminCmsDocumentPath("site_facts")}
                className={LINK}
              >
                {t("siteFacts")}
              </SiteLink>
            </li>
          ) : null}
          {tax ? (
            <li>
              <SiteLink href={APP_ROUTES.adminSettings} className={LINK}>
                {t("taxFacts")}
              </SiteLink>
            </li>
          ) : null}
        </ul>
      </Callout>
    </div>
  );
}
