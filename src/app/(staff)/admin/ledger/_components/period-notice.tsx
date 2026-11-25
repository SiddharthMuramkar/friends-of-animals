import { getTranslations } from "next-intl/server";

import { OutcomeNotice } from "@/components/form/outcome-notice";

import { periodNotice } from "../_lib/period-outcome";

export async function PeriodOutcomeNotice({
  search,
}: {
  search: Record<string, string | string[] | undefined>;
}) {
  const notice = await periodNotice(search);
  if (!notice) return null;
  const t = await getTranslations("common.callout");
  return (
    <OutcomeNotice key={notice.message} {...notice} label={t(notice.tone)} />
  );
}
