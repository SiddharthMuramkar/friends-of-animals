import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { RequestStatusChip } from "@/app/_components/privacy-request-chip";
import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form";
import { ExplainState } from "@/components/site/explain-state";
import { SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import {
  ADMIN_PRIVACY_REQUESTS,
  adminPrivacyRequestPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";
import {
  NOTE_MAX,
  REJECTION_REASON_MAX,
  RESOLUTION_MAX,
  type GrievanceRequestView,
} from "@/server/modules/privacy/requests";

import { adminCall } from "../../../_lib/boundary";
import { DueFlag } from "../_components/due-flag";
import { OfficerDenied } from "../_components/officer-denied";
import {
  addNoteAction,
  assignRequestAction,
  buildExportAction,
  completeCorrectionAction,
  executeErasureAction,
  rejectRequestAction,
  startRequestAction,
} from "../_lib/actions";
import { outcomeFromSearch, type OfficerOutcome } from "../_lib/outcome";

export async function generateMetadata(): Promise<Metadata> {
  // A generic title: browser history and tab titles show it.
  const t = await getTranslations("adminGrievance.request.meta");
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
 * One privacy request for the grievance officer (#115): who asked what
 * about whom, what they wrote, internal notes, and the next steps: start,
 * assign, refuse, complete a correction, prepare a copy of the data, or
 * preview and carry out an erasure. Opening it writes an audit row.
 */
export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/privacy/requests/[id]">) {
  const t = await getTranslations("adminGrievance");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <SiteLink href={ADMIN_PRIVACY_REQUESTS} className={LINK}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t("request.back")}
      </SiteLink>
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Request params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Request({
  params,
  searchParams,
}: Pick<PageProps<"/admin/privacy/requests/[id]">, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const useCases = as(actor);
  const call = await adminCall(
    () => useCases.getGrievanceRequest({ id }),
    adminPrivacyRequestPath(id)
  );
  if (!call.ok) return <OfficerDenied headingLevel="h1" />;
  const t = await getTranslations("adminGrievance");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("request.notFound.title")}
        headingLevel="h1"
        back={{
          href: ADMIN_PRIVACY_REQUESTS,
          label: t("request.notFound.back"),
        }}
        className="mt-8"
      >
        <p>{t("request.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { request } = call.value;
  const outcome = outcomeFromSearch(await searchParams);
  return (
    <div className="mt-6 flex flex-col gap-8">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono wrap-anywhere">
          {t("request.title", { reference: request.reference })}
        </h1>
        <RequestStatusChip
          status={request.status}
          namespace="adminGrievance.statuses"
        />
      </header>
      {outcome ? <Outcome outcome={outcome} /> : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-8">
          <Details request={request} />
          {request.type === "access" ? <ExportPanel request={request} /> : null}
          {request.type === "erasure" ? (
            <ErasurePanel request={request} useCases={useCases} />
          ) : null}
          <Notes request={request} />
        </div>
        <div className="flex flex-col gap-8">
          <NextStep request={request} />
          <Assign request={request} />
        </div>
      </div>
    </div>
  );
}

async function Outcome({ outcome }: { outcome: OfficerOutcome }) {
  const [t, callout] = await Promise.all([
    getTranslations("adminGrievance"),
    getTranslations("common.callout"),
  ]);
  return outcome.kind === "error" ? (
    <FormAlert tone="danger" label={callout("danger")}>
      <p>{t(`errors.${outcome.key}`)}</p>
    </FormAlert>
  ) : (
    <FormAlert tone="success" label={callout("success")}>
      <p>{t(`results.${outcome.key}`)}</p>
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

async function Details({ request }: { request: GrievanceRequestView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminGrievance"),
    getFormatter(),
  ]);
  const when = (date: Date | null) =>
    date === null ? (
      t("nobody")
    ) : (
      <time dateTime={date.toISOString()}>{format.dateTime(date, "long")}</time>
    );
  return (
    <section aria-labelledby="details-title" className={CARD}>
      <SectionHeading id="details-title" title={t("request.facts.label")} />
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fact term={t("request.facts.type")}>{t(`types.${request.type}`)}</Fact>
        <Fact term={t("request.facts.relation")}>
          {t(`relations.${request.relation}`)}
        </Fact>
        <Fact term={t("request.facts.subject")}>
          {request.subjectName ?? t("request.facts.subjectGone")}
        </Fact>
        <Fact term={t("request.facts.requester")}>
          {request.requester
            ? request.requester.email
              ? t("request.facts.requesterContact", {
                  name: request.requester.name,
                  email: request.requester.email,
                })
              : request.requester.name
            : t("request.facts.requesterGone")}
        </Fact>
        <Fact term={t("request.facts.filed")}>{when(request.createdAt)}</Fact>
        <Fact term={t("request.facts.due")}>
          <span className="flex flex-col items-start gap-1">
            {when(request.dueAt)}
            <DueFlag overdue={request.overdue} daysLeft={request.daysLeft} />
          </span>
        </Fact>
        <Fact term={t("request.facts.started")}>{when(request.startedAt)}</Fact>
        <Fact term={t("request.facts.closed")}>{when(request.closedAt)}</Fact>
        <Fact term={t("request.facts.assignee")}>
          {request.assignee?.name ?? t("nobody")}
        </Fact>
      </dl>
      {request.correctionDetails ? (
        <>
          <h3 className="mt-6 text-h4">{t("request.correction")}</h3>
          <div className="mt-2">
            <Typed>{request.correctionDetails}</Typed>
          </div>
        </>
      ) : null}
      {request.rejectionReason ? (
        <>
          <h3 className="mt-6 text-h4">{t("request.rejection")}</h3>
          <div className="mt-2">
            <Typed>{request.rejectionReason}</Typed>
          </div>
        </>
      ) : null}
      {request.resolution ? (
        <>
          <h3 className="mt-6 text-h4">{t("request.resolution")}</h3>
          <div className="mt-2">
            <Typed>{request.resolution}</Typed>
          </div>
        </>
      ) : null}
      {request.retained && request.retained.length > 0 ? (
        <>
          <h3 className="mt-6 text-h4">{t("request.retained")}</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-6">
            {request.retained.map((kept) => (
              <li key={kept.category}>
                {t("request.retainedItem", {
                  category: t(
                    `categories.${kept.category}` as "categories.payments"
                  ),
                  basis: t(`bases.${kept.basis}` as "bases.financial_floor"),
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Hidden({ request }: { request: GrievanceRequestView }) {
  return <input type="hidden" name="requestId" value={request.id} />;
}

async function NextStep({ request }: { request: GrievanceRequestView }) {
  const t = await getTranslations("adminGrievance.actions");
  return (
    <section aria-labelledby="next-title" className={CARD}>
      <SectionHeading id="next-title" title={t("title")} />
      {request.allowedEvents.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("none")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {request.allowedEvents.includes("start") ? (
            <form
              action={startRequestAction}
              aria-labelledby="step-start"
              className="flex flex-col gap-3"
            >
              <h3 id="step-start" className="text-h4">
                {t("start.title")}
              </h3>
              <p className="text-ink-muted">{t("start.body")}</p>
              <Hidden request={request} />
              <div>
                <SubmitButton pendingLabel={t("pending")}>
                  {t("start.submit")}
                </SubmitButton>
              </div>
            </form>
          ) : null}
          {request.allowedEvents.includes("complete") ? (
            <form
              action={completeCorrectionAction}
              aria-labelledby="step-complete"
              className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <h3 id="step-complete" className="text-h4">
                {t("complete.title")}
              </h3>
              <Hidden request={request} />
              <TextAreaField
                id="complete-resolution"
                name="resolution"
                required
                rows={4}
                maxLength={RESOLUTION_MAX}
                label={t("complete.resolution")}
                hint={t("complete.hint")}
              />
              <div>
                <SubmitButton pendingLabel={t("pending")}>
                  {t("complete.submit")}
                </SubmitButton>
              </div>
            </form>
          ) : null}
          {request.allowedEvents.includes("reject") ? (
            <form
              action={rejectRequestAction}
              aria-labelledby="step-reject"
              className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <h3 id="step-reject" className="text-h4">
                {t("reject.title")}
              </h3>
              <Hidden request={request} />
              <TextAreaField
                id="reject-reason"
                name="reason"
                required
                rows={3}
                maxLength={REJECTION_REASON_MAX}
                label={t("reject.reason")}
                hint={t("reject.hint")}
              />
              <div>
                <SubmitButton pendingLabel={t("pending")} variant="secondary">
                  {t("reject.submit")}
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}

async function Assign({ request }: { request: GrievanceRequestView }) {
  const t = await getTranslations("adminGrievance");
  if (request.closedAt !== null) return null;
  return (
    <section aria-labelledby="assign-title" className={CARD}>
      <SectionHeading id="assign-title" title={t("assign.title")} />
      <form action={assignRequestAction} className="mt-4 flex flex-col gap-4">
        <Hidden request={request} />
        <SelectField
          id="assign-officer"
          name="assigneeUserId"
          required
          defaultValue={request.assignee?.id ?? ""}
          label={t("assign.label")}
          placeholder={t("assign.placeholder")}
          options={request.officers.map((officer) => ({
            value: officer.id,
            label: officer.name,
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

async function ExportPanel({ request }: { request: GrievanceRequestView }) {
  const t = await getTranslations("adminGrievance");
  const canBuild =
    request.status === "in_progress" && request.exportState === "none";
  return (
    <section aria-labelledby="export-title" className={CARD}>
      <SectionHeading id="export-title" title={t("export.title")} />
      <p className="mt-3 text-ink-muted">{t("export.lead")}</p>
      {canBuild ? (
        <form action={buildExportAction} className="mt-4">
          <Hidden request={request} />
          <SubmitButton pendingLabel={t("actions.pending")}>
            {t("export.build")}
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-3">
          {request.exportState === "none"
            ? request.closedAt === null
              ? t("export.notStarted")
              : null
            : t(`export.${request.exportState}`)}
        </p>
      )}
    </section>
  );
}

async function ErasurePanel({
  request,
  useCases,
}: {
  request: GrievanceRequestView;
  useCases: UseCases;
}) {
  const [t, format] = await Promise.all([
    getTranslations("adminGrievance"),
    getFormatter(),
  ]);
  const failure = request.erasure.failure;
  const heading = (
    <SectionHeading id="erasure-title" title={t("erasure.title")} />
  );
  if (request.closedAt !== null) return null;
  const preview = await useCases.previewErasure({ id: request.id });
  if (!preview.ok) return null;
  const { plan, enabled } = preview.preview;
  const head = "px-3 py-2 whitespace-nowrap";
  const cell = "px-3 py-2 align-top";
  return (
    <section aria-labelledby="erasure-title" className={CARD}>
      {heading}
      <p className="mt-3 text-ink-muted">{t("erasure.lead")}</p>
      {failure ? (
        <p className="mt-3 font-semibold">{t(`erasure.failures.${failure}`)}</p>
      ) : null}
      <div className="mt-4">
        <TableScroller captionId="erasure-caption">
          <table className="w-full text-left text-sm">
            <caption id="erasure-caption" className="sr-only">
              {t("erasure.caption")}
            </caption>
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className={head}>
                  {t("erasure.category")}
                </th>
                <th scope="col" className={head}>
                  {t("erasure.action")}
                </th>
                <th scope="col" className={head}>
                  {t("erasure.basis")}
                </th>
                <th scope="col" className={head}>
                  {t("erasure.until")}
                </th>
                <th scope="col" className={head}>
                  {t("erasure.count")}
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.categories.map((each) => (
                <tr key={each.key} className="border-t border-border">
                  <th scope="row" className={cell}>
                    {t(`categories.${each.key}`)}
                  </th>
                  <td className={cell}>
                    {t(`erasure.actions.${each.action}`)}
                  </td>
                  <td className={cell}>
                    {each.basis
                      ? t(`bases.${each.basis}`)
                      : t("erasure.noBasis")}
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {each.action !== "retain"
                      ? t("erasure.noBasis")
                      : each.until
                        ? format.dateTime(each.until, "long")
                        : t("erasure.noEnd")}
                  </td>
                  <td className={cell}>{format.number(each.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </div>
      {request.erasure.approvedAt ? (
        <p className="mt-4">{t("erasure.approved")}</p>
      ) : !enabled ? (
        <p className="mt-4 text-ink-muted">{t("erasure.disabled")}</p>
      ) : request.status !== "in_progress" ? (
        <p className="mt-4 text-ink-muted">{t("erasure.notStarted")}</p>
      ) : (
        <form action={executeErasureAction} className="mt-4">
          <Hidden request={request} />
          <input type="hidden" name="fingerprint" value={plan.fingerprint} />
          <SubmitButton pendingLabel={t("erasure.pending")} variant="secondary">
            {t("erasure.submit")}
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

async function Notes({ request }: { request: GrievanceRequestView }) {
  const [t, format] = await Promise.all([
    getTranslations("adminGrievance.notes"),
    getFormatter(),
  ]);
  return (
    <section aria-labelledby="notes-title" className={CARD}>
      <SectionHeading id="notes-title" title={t("title")} />
      <p className="mt-2 text-ink-muted">{t("lead")}</p>
      {request.notes.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("empty")}</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-4">
          {request.notes.map((note) => {
            const date = format.dateTime(note.createdAt, "longDateTime");
            return (
              <li key={note.id} className="border-t border-border pt-3">
                <p className="text-sm text-ink-muted">
                  {note.author
                    ? t("by", { name: note.author.name, date })
                    : t("byNobody", { date })}
                </p>
                <div className="mt-1">
                  <Typed>{note.body}</Typed>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <form action={addNoteAction} className="mt-4 flex flex-col gap-4">
        <Hidden request={request} />
        <TextAreaField
          id="note-body"
          name="body"
          required
          rows={3}
          maxLength={NOTE_MAX}
          label={t("label")}
          hint={t("hint")}
        />
        <div>
          <SubmitButton pendingLabel={t("submit")} variant="secondary">
            {t("submit")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
