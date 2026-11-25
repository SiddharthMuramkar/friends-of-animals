import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { ExplainState } from "@/components/site/explain-state";
import { SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { MY_PRIVACY_REQUESTS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { MyRequestView } from "@/server/modules/privacy/requests";

import { RequestStatusChip } from "@/app/_components/privacy-request-chip";
import {
  cancelPrivacyRequestAction,
  downloadPrivacyExportAction,
} from "../_lib/actions";
import { viewOutcomeFrom } from "../_lib/outcome";

export async function generateMetadata(): Promise<Metadata> {
  // A generic title: browser history and tab titles show it.
  const t = await getTranslations("privacyRequests.view.meta");
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
 * One of a user's privacy requests (#115): where it stands, what was
 * asked and answered, what an erasure kept and why, and the download of a
 * copy of the data while its link works. Only whoever filed it cancels it
 * or downloads the copy.
 */
export default async function Page({
  params,
  searchParams,
}: PageProps<"/dashboard/privacy/[id]">) {
  const t = await getTranslations("privacyRequests.view");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <SiteLink href={MY_PRIVACY_REQUESTS} className={LINK}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t("back")}
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
}: Pick<PageProps<"/dashboard/privacy/[id]">, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const t = await getTranslations("privacyRequests.view");
  let request: MyRequestView;
  try {
    request = await as(actor).getMyPrivacyRequest({ id });
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
    return (
      <ExplainState
        title={t("denied.title")}
        headingLevel="h1"
        back={{ href: MY_PRIVACY_REQUESTS, label: t("denied.back") }}
        className="mt-8"
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }
  const outcome = viewOutcomeFrom(await searchParams);
  return (
    <div className="mt-6 flex flex-col gap-8">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono wrap-anywhere">
          {t("title", { reference: request.reference })}
        </h1>
        <RequestStatusChip
          status={request.status}
          namespace="privacyRequests.statuses"
        />
      </header>
      {outcome ? <Outcome outcome={outcome} /> : null}
      <Facts request={request} />
      <Answers request={request} />
      {request.export.state === "none" ? null : (
        <ExportPanel request={request} />
      )}
      {request.canCancel ? <CancelPanel requestId={request.id} /> : null}
    </div>
  );
}

async function Outcome({
  outcome,
}: {
  outcome: NonNullable<ReturnType<typeof viewOutcomeFrom>>;
}) {
  const [t, callout] = await Promise.all([
    getTranslations("privacyRequests.view"),
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

async function Facts({ request }: { request: MyRequestView }) {
  const [t, types, about, format] = await Promise.all([
    getTranslations("privacyRequests.view.facts"),
    getTranslations("privacyRequests.types"),
    getTranslations("privacyRequests.about"),
    getFormatter(),
  ]);
  const when = (date: Date | null) =>
    date === null ? (
      t("notYet")
    ) : (
      <time dateTime={date.toISOString()}>{format.dateTime(date, "long")}</time>
    );
  return (
    <section aria-labelledby="facts-title" className={CARD}>
      <SectionHeading id="facts-title" title={t("label")} />
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fact term={t("type")}>{types(request.type)}</Fact>
        <Fact term={t("about")}>
          {request.about.kind === "self"
            ? about("self")
            : request.about.name === ""
              ? about("erasedChild")
              : about("child", { name: request.about.name })}
        </Fact>
        <Fact term={t("filedBy")}>
          {request.filedByYou ? t("filedByYou") : t("filedByChild")}
        </Fact>
        <Fact term={t("filed")}>{when(request.createdAt)}</Fact>
        <Fact term={t("due")}>{when(request.dueAt)}</Fact>
        <Fact term={t("started")}>{when(request.startedAt)}</Fact>
        <Fact term={t("closed")}>{when(request.closedAt)}</Fact>
      </dl>
    </section>
  );
}

/** A block of what someone typed, kept as they wrote it. */
function Typed({ children }: { children: string }) {
  return <p className="whitespace-pre-line wrap-anywhere">{children}</p>;
}

async function Answers({ request }: { request: MyRequestView }) {
  const [t, format] = await Promise.all([
    getTranslations("privacyRequests.view"),
    getFormatter(),
  ]);
  const blocks: ReactNode[] = [];
  if (request.correctionDetails) {
    blocks.push(
      <div key="correction">
        <h2 className="text-h4">{t("correction")}</h2>
        <div className="mt-2">
          <Typed>{request.correctionDetails}</Typed>
        </div>
      </div>
    );
  }
  if (request.rejectionReason) {
    blocks.push(
      <div key="rejection">
        <h2 className="text-h4">{t("rejection")}</h2>
        <div className="mt-2 flex flex-col gap-2">
          <Typed>{request.rejectionReason}</Typed>
          <p className="text-ink-muted">{t("rejectionNext")}</p>
        </div>
      </div>
    );
  }
  if (request.resolution) {
    blocks.push(
      <div key="resolution">
        <h2 className="text-h4">{t("resolution")}</h2>
        <div className="mt-2">
          <Typed>{request.resolution}</Typed>
        </div>
      </div>
    );
  }
  if (request.retained && request.retained.length > 0) {
    blocks.push(
      <div key="retained">
        <h2 className="text-h4">{t("retained.title")}</h2>
        <p className="mt-2 text-ink-muted">{t("retained.lead")}</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 ps-6">
          {request.retained.map((kept) => (
            <li key={kept.category}>
              {t("retained.item", {
                category: t(
                  `categories.${kept.category}` as "categories.payments"
                ),
                basis: t(`bases.${kept.basis}` as "bases.financial_floor"),
                when:
                  kept.until === null
                    ? t("retained.noEnd")
                    : t("retained.until", {
                        date: format.dateTime(new Date(kept.until), "long"),
                      }),
              })}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (blocks.length === 0) return null;
  return <section className={`${CARD} flex flex-col gap-6`}>{blocks}</section>;
}

async function ExportPanel({ request }: { request: MyRequestView }) {
  const [t, format] = await Promise.all([
    getTranslations("privacyRequests.view.export"),
    getFormatter(),
  ]);
  const state = request.export;
  return (
    <section aria-labelledby="export-title" className={CARD}>
      <SectionHeading id="export-title" title={t("title")} />
      {state.state === "ready" ? (
        <form
          action={downloadPrivacyExportAction}
          className="mt-4 flex flex-col gap-4"
        >
          <p>
            {t("ready", {
              date: format.dateTime(state.expiresAt, "longDateTime"),
            })}
          </p>
          <input type="hidden" name="requestId" value={request.id} />
          <div>
            <SubmitButton pendingLabel={t("pending")}>
              {t("download")}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-ink-muted">
          {state.state === "preparing" ? t("preparing") : t("expired")}
        </p>
      )}
    </section>
  );
}

async function CancelPanel({ requestId }: { requestId: string }) {
  const t = await getTranslations("privacyRequests.view.cancel");
  return (
    <section aria-labelledby="cancel-title" className={CARD}>
      <SectionHeading id="cancel-title" title={t("title")} />
      <form
        action={cancelPrivacyRequestAction}
        className="mt-4 flex flex-col gap-4"
      >
        <p className="text-ink-muted">{t("body")}</p>
        <input type="hidden" name="requestId" value={requestId} />
        <div>
          <SubmitButton pendingLabel={t("pending")} variant="secondary">
            {t("submit")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
