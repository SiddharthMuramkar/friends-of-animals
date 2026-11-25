import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles, ButtonLink } from "@/components/site/button-link";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";
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
            <output>{t(query.result === "ok" ? "success" : "failure")}</output>
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
