import { getTranslations } from "next-intl/server";
export async function Feedback({ result }: { result: unknown }) {
  const t = await getTranslations("events");
  if (typeof result !== "string" || !t.has(`feedback.${result as "ok"}`))
    return null;
  return (
    <p
      role={
        ["ok", "registered", "waitlisted"].includes(result) ? "status" : "alert"
      }
      className="mt-4 rounded-xl border border-border bg-surface p-3 text-ink"
    >
      {t(`feedback.${result as "ok"}`)}
    </p>
  );
}
