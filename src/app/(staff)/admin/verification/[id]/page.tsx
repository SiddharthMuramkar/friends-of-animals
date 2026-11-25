import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { inputStyles } from "@/components/form";
import { as, currentActor } from "@/server/app";
import {
  ADMIN_VERIFICATION,
  adminVerificationEntryPath,
} from "@/lib/app-routes";
import {
  SEND_BACK_REASON_CODES,
  SEND_BACK_REASON_TEXT_MAX,
} from "@/server/modules/verification/domain/decide";
import { EssayText } from "@/app/participant/entries/_components/essay-text";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { decideVerification } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("entries.verification");
  return { title: t("decision"), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/verification/[id]">) {
  const [{ id }, query, actor, t] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("entries.verification"),
  ]);
  const result = await adminCall(
    () => as(actor).getVerificationEntry({ entryId: id }),
    adminVerificationEntryPath(id)
  );
  return (
    <Section width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("decision")} />
      <ButtonLink
        href={ADMIN_VERIFICATION}
        variant="secondary"
        className="mt-4"
      >
        {t("back")}
      </ButtonLink>
      {!result.ok ? (
        <AdminDenied />
      ) : !result.value.ok ? (
        <p className="mt-6 text-ink">{t("missing")}</p>
      ) : (
        <>
          <article className="mt-6 rounded-3xl border-2 border-border bg-surface p-5 text-ink">
            <h2 className="text-h3 wrap-anywhere">
              {result.value.entry.title}
            </h2>
            <p className="mt-2 text-sm">
              {result.value.entry.code} · {result.value.entry.competition}
            </p>
            <p className="mt-4 whitespace-pre-wrap wrap-anywhere">
              {result.value.entry.description}
            </p>
            {result.value.entry.statement ? (
              <p className="mt-4 whitespace-pre-wrap wrap-anywhere">
                {result.value.entry.statement}
              </p>
            ) : null}
            {result.value.entry.picture ? (
              // oxlint-disable-next-line nextjs/no-img-element -- private signed derivative
              <img
                className="mt-4 h-auto max-w-full rounded-xl"
                src={result.value.entry.picture.url}
                width={result.value.entry.picture.width}
                height={result.value.entry.picture.height}
                alt={result.value.entry.title}
                referrerPolicy="no-referrer"
              />
            ) : result.value.entry.essay ? (
              <EssayText body={result.value.entry.essay} className="mt-4" />
            ) : result.value.entry.document || result.value.entry.video ? (
              <a
                className="mt-4 block text-link underline"
                href={
                  result.value.entry.document?.url ??
                  result.value.entry.video?.url
                }
                rel="noreferrer"
              >
                {t(result.value.entry.document ? "openWork" : "openVideo")}
              </a>
            ) : (
              <p>{t("workUnavailable")}</p>
            )}
          </article>
          {query.refused ? (
            <p role="alert" className="mt-4 text-ink">
              {t("refused")}
            </p>
          ) : null}
          <form
            aria-label={t("verify")}
            action={decideVerification.bind(null, id, "verify")}
            className="mt-6"
          >
            <button
              type="submit"
              className={buttonStyles({ variant: "primary" })}
            >
              {t("verify")}
            </button>
          </form>
          <form
            aria-labelledby="send-back-heading"
            action={decideVerification.bind(null, id, "send_back")}
            className="mt-8 space-y-4 rounded-3xl border-2 border-border bg-surface p-5"
          >
            <h2 id="send-back-heading" className="text-h3">
              {t("sendBack")}
            </h2>
            <fieldset className="space-y-2">
              <legend className="font-semibold text-ink">{t("reason")}</legend>
              {SEND_BACK_REASON_CODES.map((code) => (
                <label
                  key={code}
                  className="flex min-h-12 items-center gap-3 text-ink"
                >
                  <input type="radio" required name="reason" value={code} />
                  {t(`reasonCodes.${code}`)}
                </label>
              ))}
            </fieldset>
            <div>
              <label
                htmlFor="verification-note"
                className="block font-semibold text-ink"
              >
                {t("note")}
              </label>
              <textarea
                id="verification-note"
                name="note"
                maxLength={SEND_BACK_REASON_TEXT_MAX}
                rows={4}
                className={inputStyles}
              />
            </div>
            <button
              type="submit"
              className={buttonStyles({ variant: "secondary" })}
            >
              {t("sendBack")}
            </button>
          </form>
        </>
      )}
    </Section>
  );
}
