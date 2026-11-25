import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { MY_LISTINGS } from "@/lib/app-routes";
import { DomainError } from "@/server/errors";

/** Runs `read`; a refusal becomes null, anything else is thrown. */
export async function unlessForbidden<T>(read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") return null;
    throw error;
  }
}

/** What someone who doesn't represent the listing sees. */
export async function NotYours() {
  const t = await getTranslations("adoption.manage.forbidden");
  return (
    <ExplainState
      headingLevel="h1"
      title={t("title")}
      back={{ href: MY_LISTINGS, label: t("back") }}
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}
