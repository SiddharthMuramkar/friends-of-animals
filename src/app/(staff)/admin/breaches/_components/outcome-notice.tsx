import { getTranslations } from "next-intl/server";

import { OutcomeNotice } from "@/components/form/outcome-notice";

import { breachNotice } from "../_lib/outcome";

export async function BreachOutcomeNotice({
  search,
}: {
  search: Record<string, string | string[] | undefined>;
}) {
  const notice = await breachNotice(search);
  if (!notice) return null;
  const t = await getTranslations("common.callout");
  return (
    <OutcomeNotice key={notice.message} {...notice} label={t(notice.tone)} />
  );
}
