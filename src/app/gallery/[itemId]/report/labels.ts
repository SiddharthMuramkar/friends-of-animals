import { getTranslations } from "next-intl/server";
export async function reportLabels() {
  const t = await getTranslations("gallery");
  return {
    reason: t("reportReason"),
    details: t("details"),
    contact: t("contact"),
    send: t("send"),
    sending: t("sending"),
    invalid: t("invalid"),
    reasons: (
      [
        "identifies_child",
        "inappropriate_content",
        "wrong_credit",
        "other",
      ] as const
    ).map((value) => ({ value, label: t(`reasons.${value}`) })),
  };
}
