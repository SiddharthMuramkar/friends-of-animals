import { getFormatter, getTranslations } from "next-intl/server";
import { as, currentActor } from "@/server/app";
import { ENTRY_TEXT_LIMITS } from "@/server/modules/entries/domain/entry-text";
import { inputStyles, SubmitButton } from "@/components/form";
import { redirect } from "next/navigation";
import { SEND_BACK_REASON_CODES } from "@/server/modules/verification/domain/decide";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function resubmit(id: string, href: string, form: FormData) {
  "use server";
  const actor = await currentActor();
  const result = await as(actor).resubmitEntry({
    entryId: id,
    title: text(form, "title"),
    description: text(form, "description"),
    statement: text(form, "statement"),
  });
  if (!result.ok)
    redirect(`${href}${href.includes("?") ? "&" : "?"}resubmitError=1`);
  redirect(href);
}

type SentBack = {
  id: string;
  title: string;
  description: string;
  statement: string | null;
  correction: {
    reasonCode: string;
    reasonText: string | null;
    dueAt: Date;
  } | null;
};
export async function Correction({
  entry,
  href,
  canCorrect,
  refused,
}: {
  entry: SentBack;
  href: string;
  canCorrect: boolean;
  refused?: boolean;
}) {
  if (!entry.correction) return null;
  const [t, format] = await Promise.all([
    getTranslations("entries.verification"),
    getFormatter(),
  ]);
  const reason =
    SEND_BACK_REASON_CODES.find((r) => r === entry.correction?.reasonCode) ??
    "other";
  return (
    <section
      aria-labelledby="correction-heading"
      className="mt-8 rounded-3xl border-2 border-border bg-surface p-5 text-ink"
    >
      <h2 id="correction-heading" className="text-h3">
        {t("correction")}
      </h2>
      <p className="mt-3 font-semibold">{t(`reasonCodes.${reason}`)}</p>
      {entry.correction.reasonText ? (
        <p className="mt-2 whitespace-pre-wrap wrap-anywhere">
          {entry.correction.reasonText}
        </p>
      ) : null}
      <p className="mt-3">
        {t("due", {
          date: format.dateTime(entry.correction.dueAt, "longDateTime"),
        })}
      </p>
      {canCorrect ? (
        <>
          <p className="mt-3">{t("fileHint")}</p>
          {refused ? (
            <p role="alert" className="mt-3">
              {t("resubmitError")}
            </p>
          ) : null}
          <form
            action={resubmit.bind(null, entry.id, href)}
            aria-label={t("resubmit")}
            className="mt-4 space-y-4"
          >
            <div>
              <label htmlFor="correction-title" className="block font-semibold">
                {t("title")}
              </label>
              <input
                id="correction-title"
                name="title"
                defaultValue={entry.title}
                maxLength={ENTRY_TEXT_LIMITS.title}
                required
                className={inputStyles}
              />
            </div>
            <div>
              <label
                htmlFor="correction-description"
                className="block font-semibold"
              >
                {t("description")}
              </label>
              <textarea
                id="correction-description"
                name="description"
                defaultValue={entry.description}
                maxLength={ENTRY_TEXT_LIMITS.description}
                required
                rows={3}
                className={inputStyles}
              />
            </div>
            <div>
              <label
                htmlFor="correction-statement"
                className="block font-semibold"
              >
                {t("statement")}
              </label>
              <textarea
                id="correction-statement"
                name="statement"
                defaultValue={entry.statement ?? ""}
                maxLength={ENTRY_TEXT_LIMITS.statement}
                rows={3}
                className={inputStyles}
              />
            </div>
            <SubmitButton pendingLabel={t("resubmit")}>
              {t("resubmit")}
            </SubmitButton>
          </form>
        </>
      ) : null}
    </section>
  );
}
