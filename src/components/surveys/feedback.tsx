import { getTranslations } from "next-intl/server";
export async function SurveyFeedback({ result }: { result: unknown }) {
  const t = await getTranslations("surveys");
  const keys = [
    "saved",
    "sent",
    "complete",
    "closed",
    "unavailable",
    "disabled",
    "invalid_input",
    "results_not_published",
    "no_recipients",
    "forbidden",
  ] as const;
  const key = keys.find((k) => k === result);
  return key ? (
    <p
      role="status"
      className="my-5 rounded-xl border border-border bg-surface p-4 text-ink"
    >
      {t(key)}
    </p>
  ) : null;
}
