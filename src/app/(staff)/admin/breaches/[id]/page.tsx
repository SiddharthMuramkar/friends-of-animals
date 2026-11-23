import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { SubmitButton, TextAreaField } from "@/components/form";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_BREACHES, adminBreachPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { BREACH_NOTE_MAX } from "@/server/modules/breaches/domain/breach-status";
import type { BreachView } from "@/server/modules/breaches/read";

import { adminCall } from "../../_lib/boundary";
import { BreachAccessState } from "../_components/access-state";
import { BreachActions } from "../_components/breach-actions";
import { BreachDetailsForm } from "../_components/breach-fields";
import { BreachOutcomeNotice } from "../_components/outcome-notice";
import { breachDetailsLabels } from "../_lib/details-labels";
import { addBreachNoteAction, updateBreachAction } from "../actions";

const PANEL =
  "min-w-0 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBreaches");
  // The record title can hold sensitive text. Keep it out of browser history.
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

export default async function Page(props: PageProps<"/admin/breaches/[id]">) {
  const t = await getTranslations("adminBreaches");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <BreachDetail {...props} />
      </Suspense>
    </Section>
  );
}

async function BreachDetail({
  params,
  searchParams,
}: PageProps<"/admin/breaches/[id]">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).getBreach({ breachId: id }),
    adminBreachPath(id)
  );
  if (!call.ok) return <BreachAccessState state="denied" />;
  if (!call.value.ok) return <BreachAccessState state="missing" />;

  const { breach } = call.value;
  const t = await getTranslations("adminBreaches");
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SiteLink
        href={ADMIN_BREACHES}
        className="inline-flex min-h-11 w-fit items-center font-semibold text-link underline underline-offset-4"
      >
        {t("back")}
      </SiteLink>
      <PageHeader title={breach.title} className="wrap-anywhere" />
      <BreachOutcomeNotice search={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <BreachOverview breach={breach} />
          <Timeline breach={breach} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <BreachActions breach={breach} />
          {breach.status === "closed" ? null : (
            <Disclosure summary={t("forms.edit")} className="min-w-0">
              <BreachDetailsForm
                action={updateBreachAction.bind(null, id)}
                labels={await breachDetailsLabels(true)}
                initial={{
                  title: breach.title,
                  severity: breach.severity,
                  affectedCount: String(breach.affectedCount),
                  personalDataInvolved: breach.personalDataInvolved,
                  minorsAffected: breach.minorsAffected,
                  impact: breach.impact,
                }}
              />
            </Disclosure>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="wrap-anywhere">{children}</dd>
    </div>
  );
}

async function BreachOverview({ breach }: { breach: BreachView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminBreaches"),
    getFormatter(),
  ]);
  const when = (date: Date | null) =>
    date ? (
      <time dateTime={date.toISOString()}>
        {format.dateTime(date, "dateTime")}
      </time>
    ) : (
      t("fields.none")
    );
  const { authority, unreachable } = breach;
  return (
    <section className={PANEL}>
      <SectionHeading title={t("summary.title")} />
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fact label={t("fields.status")}>{t(`statuses.${breach.status}`)}</Fact>
        <Fact label={t("fields.severity")}>
          {t(`severities.${breach.severity}`)}
        </Fact>
        <Fact label={t("fields.awareAt")}>{when(breach.awareAt)}</Fact>
        <Fact label={t("fields.lead")}>
          {breach.lead?.name ?? t("fields.none")}
        </Fact>
        <Fact label={t("fields.count")}>
          {format.number(breach.affectedCount)}
        </Fact>
        <Fact label={t("fields.personalData")}>
          {t(breach.personalDataInvolved ? "fields.yes" : "fields.no")}
        </Fact>
        <Fact label={t("fields.minors")}>
          {t(breach.minorsAffected ? "fields.yes" : "fields.no")}
        </Fact>
        <Fact label={t("fields.containedAt")}>{when(breach.containedAt)}</Fact>
        {breach.closedAt ? (
          <Fact label={t("fields.closedAt")}>{when(breach.closedAt)}</Fact>
        ) : null}
      </dl>
      <h3 className="mt-5">{t("fields.impact")}</h3>
      <p className="mt-2 whitespace-pre-wrap wrap-anywhere">{breach.impact}</p>
      <h3 className="mt-6">{t("summary.notices")}</h3>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <Fact label={t("summary.recipients")}>
          {format.number(breach.notices.recipients)}
        </Fact>
        {breach.notices.pending ? (
          <Fact label={t("summary.pendingRecipients")}>
            {format.number(breach.notices.pending)}
          </Fact>
        ) : null}
        <Fact label={t("fields.principalsNotifiedAt")}>
          {breach.fanOutPending && !breach.principalsNotifiedAt
            ? t("summary.fanOutPending")
            : when(breach.principalsNotifiedAt)}
        </Fact>
        <Fact label={t("summary.unreachable")}>
          {format.number(unreachable.total)}
          {unreachable.total ? (
            <ul className="mt-1 list-disc ps-5 text-sm">
              <li>
                {t("summary.noGuardian")} (
                {format.number(unreachable.noGuardian)})
              </li>
              <li>
                {t("summary.noAccount")} ({format.number(unreachable.noAccount)}
                )
              </li>
            </ul>
          ) : null}
        </Fact>
        <Fact label={t("summary.authority")}>
          {authority.channel === "manual" ? (
            <>
              {t("summary.authorityManual")} · {when(authority.notifiedAt)}
              <br />
              {authority.reference}
            </>
          ) : authority.channel === "email" ? (
            <>
              {t(
                authority.emailSentAt
                  ? "summary.authoritySent"
                  : authority.emailFailedAt
                    ? "summary.authorityFailed"
                    : "summary.authorityPending"
              )}{" "}
              ·{" "}
              {when(
                authority.emailSentAt ??
                  authority.emailFailedAt ??
                  authority.emailQueuedAt
              )}
            </>
          ) : (
            t("summary.authorityMissing")
          )}
        </Fact>
      </dl>
    </section>
  );
}

async function Timeline({ breach }: { breach: BreachView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminBreaches"),
    getFormatter(),
  ]);
  return (
    <section className={PANEL}>
      <SectionHeading title={t("timeline.title")} />
      <ol className="mt-4 list-decimal space-y-4 ps-6">
        {breach.timeline.map((event) => (
          <li key={event.id}>
            <p className="font-semibold">{t(`timeline.${event.kind}`)}</p>
            <p className="text-sm text-ink-muted wrap-anywhere">
              <time dateTime={event.occurredAt.toISOString()}>
                {format.dateTime(event.occurredAt, "dateTime")}
              </time>
              {event.author ? <> · {event.author.name}</> : null}
            </p>
            {event.note ? (
              <p className="mt-1 whitespace-pre-wrap wrap-anywhere">
                {event.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <form
        aria-label={t("forms.note")}
        action={addBreachNoteAction.bind(null, breach.id)}
        className="mt-5 flex flex-col gap-4 border-t border-border pt-5"
      >
        <TextAreaField
          id="breach-note"
          name="note"
          label={t("forms.note")}
          rows={3}
          maxLength={BREACH_NOTE_MAX}
          required
        />
        <SubmitButton className="self-start" pendingLabel={t("forms.pending")}>
          {t("forms.noteSubmit")}
        </SubmitButton>
      </form>
    </section>
  );
}
