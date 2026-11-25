import { Suspense } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  ADMIN_JUDGING_ROUNDS,
  adminCompetitionResultsPath,
} from "@/lib/app-routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import { ROUTES, slugHref } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { AdminDenied } from "../../../_components/admin-denied";
import { resultsAction } from "./actions";

export const metadata = {
  title: "Results release",
  robots: { index: false, follow: false },
};
type Props = PageProps<"/admin/competitions/[id]/results">;
const CARD =
  "grid gap-4 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6";
async function ResultsPanel({ params, searchParams }: Props) {
  await connection();
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, { done }, t, format] = await Promise.all([
    params,
    searchParams,
    getTranslations("results"),
    getFormatter(),
  ]);
  const api = as(actor);
  let data;
  try {
    data = await api.getResultsRelease({ competitionId: id });
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "forbidden") return <AdminDenied />;
      const path = secondFactorPath(
        error.code,
        adminCompetitionResultsPath(id)
      );
      if (path) redirect(path);
    }
    throw error;
  }

  if (!data.ok) return <p>{t("notFound")}</p>;
  const { competition, release, awards, finalRounds, rejected } = data;
  const access = await api.myAccess();
  const mayPrepare = access.grants.some(
    (g) =>
      g.role === "competition_manager" &&
      (g.scope.type === "global" ||
        (g.scope.type === "competition" && g.scope.id === id))
  );
  const canReview =
    release?.preparedByUserId !== null &&
    release?.preparedByUserId !== actor.userId;
  const hidden = (operation: string) => (
    <>
      <input type="hidden" name="competitionId" value={id} />
      <input type="hidden" name="operation" value={operation} />
      {release && <input type="hidden" name="releaseId" value={release.id} />}
    </>
  );
  const when = (d: Date) => format.dateTime(d, "longDateTime");
  return (
    <div className="grid gap-6">
      <ButtonLink variant="quiet" href={ADMIN_JUDGING_ROUNDS}>
        {t("backRounds")}
      </ButtonLink>
      <PageHeader title={t("staffTitle")} lead={competition.name} tile="blue" />
      {typeof done === "string" &&
        t.has(`notices.${done}` as Parameters<typeof t>[0]) && (
          <output className="block rounded-2xl border-2 border-border bg-surface p-4 font-semibold">
            {t(`notices.${done}` as Parameters<typeof t>[0])}
          </output>
        )}
      {release ? (
        <>
          <section className={CARD}>
            <SectionHeading title={t(`status.${release.status}`)} />
            <dl className="grid gap-2">
              <dt className="font-semibold">{t("scheduledAt")}</dt>
              <dd>{when(release.publishAt)}</dd>
              {release.publishedAt && (
                <>
                  <dt className="font-semibold">{t("publishedAt")}</dt>
                  <dd>{when(release.publishedAt)}</dd>
                </>
              )}
              <dt className="font-semibold">{t("delivery")}</dt>
              <dd className="whitespace-pre-wrap">{release.deliveryNote}</dd>
              <dt className="font-semibold">{t("awardCount")}</dt>
              <dd>{awards.length}</dd>
            </dl>
            {release.status === "published" && (
              <ButtonLink
                href={slugHref("competitionResults", competition.slug)}
                prefetch={false}
              >
                {t("publicLink")}
              </ButtonLink>
            )}
          </section>
          <section className={CARD}>
            <SectionHeading title={t("reviewAwards")} />
            <p>{t("snapshotHelp")}</p>
            {!awards.length ? (
              <p>{t("noAwards")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {awards.map((a) => (
                  <li key={a.entryCode} className="grid gap-1 py-3">
                    <span className="font-semibold">
                      {a.entryCode} · {a.categoryLabel}
                    </span>
                    <span>
                      {t(`disciplines.${a.discipline}`)} ·{" "}
                      {a.awardBand
                        ? t(`bands.${a.awardBand}`)
                        : t(`outcomes.${a.outcome}`)}
                    </span>
                    {a.prize && <span>{a.prize}</span>}
                    {a.suitableForAuction && (
                      <span>{t("auctionSuitability")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {release.status === "pending_approval" && (
            <section className={CARD}>
              <SectionHeading title={t("review")} />
              <p>{canReview ? t("approvalHelp") : t("selfApproval")}</p>
              {canReview && (
                <form action={resultsAction} aria-label={t("approve")}>
                  {hidden("approve")}
                  <SubmitButton pendingLabel={t("working")}>
                    {t("approve")}
                  </SubmitButton>
                </form>
              )}
            </section>
          )}
          {canReview &&
            (release.status === "pending_approval" ||
              release.status === "approved") && (
              <form
                className={CARD}
                action={resultsAction}
                aria-label={t("reject")}
              >
                <p>{t("rejectHelp")}</p>
                {hidden("reject")}
                <SubmitButton pendingLabel={t("working")}>
                  {t("reject")}
                </SubmitButton>
              </form>
            )}
        </>
      ) : (
        <section className={CARD}>
          <SectionHeading title={t("prepare")} />
          <p>{t("prepareHelp")}</p>
          {competition.status === "foa_judging" &&
          mayPrepare &&
          finalRounds.length ? (
            <form
              action={resultsAction}
              className="grid gap-4"
              aria-label={t("prepare")}
            >
              {hidden("prepare")}
              <SelectField
                id="final-round"
                name="sourceRoundId"
                label={t("finalRound")}
                placeholder={t("selectRound")}
                options={finalRounds.map((r) => ({
                  value: r.id,
                  label: r.name,
                }))}
                required
              />
              <TextField
                id="schedule"
                name="publishAt"
                type="datetime-local"
                step={1}
                label={t("schedule")}
                hint={t("scheduleHelp")}
                required
              />
              <TextAreaField
                id="delivery"
                name="deliveryNote"
                label={t("delivery")}
                hint={t("deliveryHelp")}
                minLength={10}
                maxLength={500}
                required
              />
              <SubmitButton pendingLabel={t("working")}>
                {t("submit")}
              </SubmitButton>
            </form>
          ) : (
            <p>{t("unavailable")}</p>
          )}
          {!!rejected.length && (
            <p>{t("rejectedCount", { count: rejected.length })}</p>
          )}
        </section>
      )}
    </div>
  );
}
export default async function Page(props: Props) {
  const t = await getTranslations("results");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p>{t("loading")}</p>}>
        <ResultsPanel {...props} />
      </Suspense>
    </Section>
  );
}
