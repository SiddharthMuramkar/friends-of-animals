import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles, ButtonLink } from "@/components/site/button-link";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";
import { SubmitButton } from "@/components/form";
import { ADMIN_CERTIFICATES } from "@/lib/app-routes";
export const instant = false;
export const metadata = {
  title: "Certificates",
  robots: { index: false, follow: false },
};
async function retry(certificateId: string, competitionId: string) {
  "use server";
  const result = await adminCall(
    async () =>
      as(await currentActor()).retryCertificateRender({ certificateId }),
    ADMIN_CERTIFICATES
  );
  redirect(
    `${ADMIN_CERTIFICATES}?competition=${encodeURIComponent(competitionId)}&result=${result.ok && result.value.ok ? "ok" : "error"}`
  );
}
async function correct(
  certificateId: string,
  competitionId: string,
  mode: "revoke" | "reissue",
  form: FormData
) {
  "use server";
  const path = `${ADMIN_CERTIFICATES}?competition=${encodeURIComponent(competitionId)}`;
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const reason = field("reason");
  const result = await adminCall(async () => {
    const app = as(await currentActor());
    return mode === "revoke"
      ? app.revokeCertificate({ certificateId, reason })
      : app.reissueCertificate({
          certificateId,
          reason,
          recipientName: field("recipientName"),
        });
  }, path);
  redirect(
    `${path}&result=${result.ok && result.value.ok ? mode : "correction-error"}`
  );
}
export default async function Page({
  searchParams,
}: PageProps<"/admin/certificates">) {
  const [actor, t, format, query] = await Promise.all([
    currentActor(),
    getTranslations("certificates"),
    getFormatter(),
    searchParams,
  ]);
  const app = as(actor);
  const comps = await adminCall(
    () => app.listCertificateCompetitions(),
    ADMIN_CERTIFICATES
  );
  const selected = comps.ok
    ? (comps.value.find((c) => c.id === query.competition) ?? comps.value[0])
    : undefined;
  const rows = selected
    ? await adminCall(
        () => app.listCertificates({ competitionId: selected.id }),
        ADMIN_CERTIFICATES
      )
    : null;
  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("adminLead")} />
      {!comps.ok || rows?.ok === false ? (
        <AdminDenied />
      ) : (
        <div className="mt-8 grid gap-6">
          {query.result && (
            <output>
              {t(
                query.result === "ok"
                  ? "success"
                  : query.result === "revoke"
                    ? "revokedSuccess"
                    : query.result === "reissue"
                      ? "reissuedSuccess"
                      : query.result === "correction-error"
                        ? "correctionError"
                        : "failure"
              )}
            </output>
          )}
          {comps.value.length > 0 && (
            <search>
              <form
                method="get"
                action={ADMIN_CERTIFICATES}
                className="grid gap-3 max-w-xl"
              >
                <label
                  htmlFor="certificate-competition"
                  className="font-semibold"
                >
                  {t("competition")}
                </label>
                <select
                  id="certificate-competition"
                  name="competition"
                  defaultValue={selected?.id}
                  className="min-h-12 rounded-xl border-2 border-border-strong bg-surface p-2"
                >
                  {comps.value.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                <button
                  className={buttonStyles({ variant: "secondary" })}
                  type="submit"
                >
                  {t("choose")}
                </button>
              </form>
            </search>
          )}
          {rows?.ok && rows.value.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2">
              {rows.value.map((c) => (
                <li
                  key={c.id}
                  className="grid gap-3 rounded-3xl border-2 border-border bg-surface p-5"
                >
                  <h2 className="text-h3 break-words">{c.number}</h2>
                  <p>
                    {t(`type.${c.type}`)} · {t(`status.${c.status}`)} ·{" "}
                    {t(`renderStatus.${c.renderStatus}`)}
                  </p>
                  <p>{format.dateTime(c.issuedAt, "longDateTime")}</p>
                  <ButtonLink href={`/verify/${c.number}`} variant="secondary">
                    {t("verify")}
                    <span className="sr-only"> {c.number}</span>
                  </ButtonLink>
                  {c.revokedReason && (
                    <p className="wrap-anywhere">
                      {t("recordedReason", { reason: c.revokedReason })}
                    </p>
                  )}
                  {c.correction && (
                    <details className="rounded-2xl border border-border p-3">
                      <summary className="cursor-pointer font-semibold min-h-12 py-3">
                        {t("correct")}
                        <span className="sr-only"> {c.number}</span>
                      </summary>
                      <div className="grid gap-6">
                        <p>{t("correctionHelp")}</p>
                        <form
                          action={correct.bind(
                            null,
                            c.id,
                            selected!.id,
                            "revoke"
                          )}
                          aria-labelledby={`revoke-${c.id}`}
                          className="grid gap-2"
                        >
                          <h3 id={`revoke-${c.id}`} className="font-semibold">
                            {t("revoke")}
                          </h3>
                          <label htmlFor={`revokeReason-${c.id}`}>
                            {t("reason")}
                          </label>
                          <textarea
                            id={`revokeReason-${c.id}`}
                            name="reason"
                            required
                            maxLength={1000}
                            className="min-h-24 rounded-xl border-2 border-border-strong bg-surface p-3"
                          />
                          <SubmitButton
                            variant="secondary"
                            pendingLabel={t("saving")}
                          >
                            {t("revoke")}
                          </SubmitButton>
                        </form>
                        <form
                          action={correct.bind(
                            null,
                            c.id,
                            selected!.id,
                            "reissue"
                          )}
                          aria-labelledby={`reissue-${c.id}`}
                          className="grid gap-2"
                        >
                          <h3 id={`reissue-${c.id}`} className="font-semibold">
                            {t("reissue")}
                          </h3>
                          <label htmlFor={`correctName-${c.id}`}>
                            {t("correctName")}
                          </label>
                          <input
                            id={`correctName-${c.id}`}
                            name="recipientName"
                            required
                            maxLength={150}
                            defaultValue={c.correction.recipientName}
                            autoComplete="off"
                            className="min-h-12 rounded-xl border-2 border-border-strong bg-surface p-3"
                          />
                          <label htmlFor={`reissueReason-${c.id}`}>
                            {t("reason")}
                          </label>
                          <textarea
                            id={`reissueReason-${c.id}`}
                            name="reason"
                            required
                            maxLength={1000}
                            className="min-h-24 rounded-xl border-2 border-border-strong bg-surface p-3"
                          />
                          <SubmitButton pendingLabel={t("saving")}>
                            {t("reissue")}
                          </SubmitButton>
                        </form>
                      </div>
                    </details>
                  )}
                  {c.status === "issued" && c.renderStatus === "failed" && (
                    <form action={retry.bind(null, c.id, selected!.id)}>
                      <button
                        className={buttonStyles({ variant: "primary" })}
                        type="submit"
                      >
                        {t("retry")}
                        <span className="sr-only"> {c.number}</span>
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("empty")}</p>
          )}
        </div>
      )}
    </Section>
  );
}
