import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import { ExplainState } from "@/components/site/explain-state";
import { SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  AUTHORITY_REFERENCE_MAX,
  NOTE_MAX,
  OUTCOME_MAX,
  SAFEGUARDING_SEVERITIES,
  type IncidentLogEntryView,
  type ReportEvent,
  type SafeguardingReportView,
} from "@/server/modules/safeguarding";

import { adminCall } from "../../_lib/boundary";
import { LeadDenied } from "../_components/lead-denied";
import { StatusChip } from "../_components/status-chip";
import {
  addNoteAction,
  assignReportAction,
  moveReportAction,
} from "../_lib/actions";
import {
  outcomeFromSearch,
  reportHref,
  type LeadOutcome,
} from "../_lib/outcome";

export async function generateMetadata(): Promise<Metadata> {
  // A generic title: browser history and tab titles show it.
  const t = await getTranslations("adminSafeguarding.report.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * One safeguarding report, decrypted for the lead, with its incident log
 * and the steps the transition table allows next (#116). Opening it writes
 * an audit row; so does every step.
 */
export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/safeguarding/[id]">) {
  const t = await getTranslations("adminSafeguarding");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <SiteLink href={APP_ROUTES.adminSafeguarding} className={LINK}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t("report.back")}
      </SiteLink>
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Report params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Report({
  params,
  searchParams,
}: Pick<PageProps<"/admin/safeguarding/[id]">, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).viewSafeguardingReport({ reportId: id }),
    reportHref(id)
  );
  if (!call.ok) return <LeadDenied headingLevel="h1" />;
  const t = await getTranslations("adminSafeguarding");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("report.notFound.title")}
        headingLevel="h1"
        back={{
          href: APP_ROUTES.adminSafeguarding,
          label: t("report.notFound.back"),
        }}
        className="mt-8"
      >
        <p>{t("report.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { report } = call.value;
  const outcome = outcomeFromSearch(await searchParams);

  return (
    <div className="mt-6 flex flex-col gap-8">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono wrap-anywhere">
          {t("report.title", { reference: report.reference })}
        </h1>
        <StatusChip status={report.status} />
      </header>
      {outcome ? <OutcomeAlert outcome={outcome} /> : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-8">
          <Details report={report} />
          <IncidentLog reportId={report.id} log={report.log} />
        </div>
        <div className="flex flex-col gap-8">
          <NextStep report={report} />
          <Assign report={report} />
        </div>
      </div>
    </div>
  );
}

async function OutcomeAlert({ outcome }: { outcome: LeadOutcome }) {
  const [t, tc] = await Promise.all([
    getTranslations("adminSafeguarding"),
    getTranslations("common.callout"),
  ]);
  if (outcome.kind === "error") {
    return (
      <FormAlert tone="danger" label={tc("danger")}>
        <p>{t(`errors.${outcome.key}`)}</p>
      </FormAlert>
    );
  }
  return (
    <FormAlert tone="success" label={tc("success")}>
      <p>
        {outcome.key === "moved"
          ? t("results.moved", { status: t(`statuses.${outcome.status}`) })
          : t(`results.${outcome.key}`)}
      </p>
    </FormAlert>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm font-semibold text-ink-muted">{term}</dt>
      <dd className="text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}

/** A block of what someone typed, kept as they wrote it. */
function Typed({ children }: { children: string }) {
  return <p className="whitespace-pre-line wrap-anywhere">{children}</p>;
}

async function Details({ report }: { report: SafeguardingReportView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminSafeguarding"),
    getFormatter(),
  ]);
  const when = (date: Date) => (
    <time dateTime={date.toISOString()}>
      {format.dateTime(date, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
  return (
    <section aria-labelledby="details-title" className={CARD}>
      <SectionHeading id="details-title" title={t("report.facts.label")} />
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fact term={t("report.facts.category")}>
          {t(`categories.${report.category}`)}
        </Fact>
        <Fact term={t("report.facts.severity")}>
          {t(`severities.${report.severity ?? "none"}`)}
        </Fact>
        <Fact term={t("report.facts.assignee")}>
          {report.assignedTo?.name ?? t("nobody")}
        </Fact>
        <Fact term={t("report.facts.received")}>{when(report.createdAt)}</Fact>
        {report.resolvedAt ? (
          <Fact term={t("report.facts.resolved")}>
            {when(report.resolvedAt)}
          </Fact>
        ) : null}
        <Fact term={t("report.facts.subjectAge")}>
          {report.subjectAge === null
            ? t("report.unknownAge")
            : t("report.age", { age: report.subjectAge })}
        </Fact>
        <Fact term={t("report.facts.reporterIsChild")}>
          {report.reporterIsChild
            ? t("report.facts.yes")
            : t("report.facts.no")}
        </Fact>
      </dl>

      <h3 className="mt-6 text-h4">{t("report.description")}</h3>
      <div className="mt-2">
        <Typed>{report.description}</Typed>
      </div>

      <h3 className="mt-6 text-h4">{t("report.subjectDetails")}</h3>
      <div className="mt-2">
        {report.subjectDetails ? (
          <Typed>{report.subjectDetails}</Typed>
        ) : (
          <p className="text-ink-muted">{t("report.notGiven")}</p>
        )}
      </div>

      <h3 className="mt-6 text-h4">{t("report.reporter")}</h3>
      {report.anonymous ? (
        <p className="mt-2 text-ink-muted">{t("report.anonymousReporter")}</p>
      ) : (
        <dl className="mt-2 grid gap-4 sm:grid-cols-2">
          <Fact term={t("report.reporterName")}>
            {report.reporterName ?? t("report.notGiven")}
          </Fact>
          <Fact term={t("report.reporterContact")}>
            {report.reporterContact ?? t("report.notGiven")}
          </Fact>
        </dl>
      )}

      {report.escalationReference ? (
        <>
          <h3 className="mt-6 text-h4">{t("report.escalationReference")}</h3>
          <div className="mt-2">
            <Typed>{report.escalationReference}</Typed>
          </div>
        </>
      ) : null}
      {report.outcome ? (
        <>
          <h3 className="mt-6 text-h4">{t("report.outcome")}</h3>
          <div className="mt-2">
            <Typed>{report.outcome}</Typed>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** The fields one step's form asks for, beyond the report and the event. */
async function StepFields({ event }: { event: ReportEvent }) {
  const t = await getTranslations("adminSafeguarding");
  switch (event) {
    case "triage":
      return (
        <SelectField
          id="triage-severity"
          name="severity"
          required
          label={t("actions.triage.severity")}
          placeholder={t("actions.triage.placeholder")}
          options={SAFEGUARDING_SEVERITIES.map((severity) => ({
            value: severity,
            label: t(`severities.${severity}`),
          }))}
        />
      );
    case "start_investigation":
      return (
        <p className="text-ink-muted">
          {t("actions.start_investigation.body")}
        </p>
      );
    case "escalate":
      return (
        <TextField
          id="escalate-reference"
          name="authorityReference"
          required
          maxLength={AUTHORITY_REFERENCE_MAX}
          autoComplete="off"
          label={t("actions.escalate.reference")}
          hint={t("actions.escalate.hint")}
        />
      );
    case "resolve":
      return (
        <TextAreaField
          id="resolve-outcome"
          name="outcome"
          required
          maxLength={OUTCOME_MAX}
          rows={4}
          label={t("actions.resolve.outcome")}
          hint={t("actions.resolve.hint")}
        />
      );
  }
}

async function NextStep({ report }: { report: SafeguardingReportView }) {
  const t = await getTranslations("adminSafeguarding");
  return (
    <section aria-labelledby="next-title" className={CARD}>
      <SectionHeading id="next-title" title={t("actions.title")} />
      {report.allowedEvents.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("actions.none")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {report.allowedEvents.map((event) => (
            <form
              key={event}
              action={moveReportAction}
              aria-labelledby={`step-${event}`}
              className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <h3 id={`step-${event}`} className="text-h4">
                {t(`actions.${event}.title`)}
              </h3>
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="event" value={event} />
              <StepFields event={event} />
              <div>
                <SubmitButton
                  pendingLabel={t("actions.pending")}
                  variant={event === "resolve" ? "secondary" : "primary"}
                >
                  {t(`actions.${event}.submit`)}
                </SubmitButton>
              </div>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}

async function Assign({ report }: { report: SafeguardingReportView }) {
  const t = await getTranslations("adminSafeguarding");
  if (report.status === "resolved") return null;
  return (
    <section aria-labelledby="assign-title" className={CARD}>
      <SectionHeading id="assign-title" title={t("assign.title")} />
      <form action={assignReportAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="reportId" value={report.id} />
        <SelectField
          id="assign-lead"
          name="assigneeUserId"
          defaultValue={report.assignedTo?.id ?? ""}
          label={t("assign.label")}
          placeholder={t("assign.placeholder")}
          options={report.leads.map((lead) => ({
            value: lead.id,
            label: lead.name,
          }))}
        />
        <div>
          <SubmitButton pendingLabel={t("actions.pending")} variant="secondary">
            {t("assign.submit")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

async function IncidentLog({
  reportId,
  log,
}: {
  reportId: string;
  log: IncidentLogEntryView[];
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminSafeguarding"),
    getFormatter(),
  ]);
  return (
    <section aria-labelledby="log-title" className={CARD}>
      <SectionHeading id="log-title" title={t("log.title")} />
      {log.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("log.empty")}</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-4">
          {log.map((entry) => (
            <li
              key={entry.id}
              className="border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
                <span className="font-semibold text-ink">
                  {t(`log.kinds.${entry.kind}`)}
                </span>
                <span>{entry.author?.name ?? t("log.formerLead")}</span>
                <time dateTime={entry.createdAt.toISOString()}>
                  {format.dateTime(entry.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </p>
              {entry.toStatus ? (
                <p className="mt-1">
                  {t("log.moved", { status: t(`statuses.${entry.toStatus}`) })}
                  {entry.severity
                    ? ` · ${t("log.severity", { severity: t(`severities.${entry.severity}`) })}`
                    : null}
                </p>
              ) : null}
              {entry.body ? (
                <div className="mt-1">
                  <Typed>{entry.body}</Typed>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <form
        action={addNoteAction}
        className="mt-6 flex flex-col gap-4 border-t border-border pt-6"
      >
        <input type="hidden" name="reportId" value={reportId} />
        <TextAreaField
          id="log-note"
          name="body"
          required
          maxLength={NOTE_MAX}
          rows={3}
          label={t("log.note.label")}
          hint={t("log.note.hint")}
        />
        <div>
          <SubmitButton pendingLabel={t("actions.pending")} variant="secondary">
            {t("log.note.submit")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
