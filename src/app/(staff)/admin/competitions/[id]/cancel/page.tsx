import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { adminCompetitionCancelPath, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  CancellationEffects,
  CompetitionCancellation,
} from "@/server/modules/competitions";
import { CANCEL_REASON_MAX_LENGTH } from "@/server/modules/competitions/cancel-competition";
import {
  formatCapturedAmount,
  formatPaise,
} from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../../../_lib/boundary";
import { StatusChip } from "../../_components/admin-states";
import { CancelForm } from "./_components/cancel-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("competitionCancel.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

type Props = PageProps<"/admin/competitions/[id]/cancel">;

/**
 * Cancelling a competition (#80), for super admins: what cancelling does,
 * counted, and the form that does it behind a fresh second factor; once
 * cancelled, when and why.
 */
export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("competitionCancel");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      {/* The id and who is asking are read per request: the page streams
          in behind this boundary. */}
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Cancel params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Cancel({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).getCompetitionCancellation({ competitionId: id }),
    adminCompetitionCancelPath(id)
  );
  const t = await getTranslations("competitionCancel");
  if (!call.ok) {
    return (
      <ExplainState
        title={t("denied.title")}
        headingLevel="h1"
        back={{ href: APP_ROUTES.dashboard, label: t("denied.back") }}
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("notFound.title")}
        headingLevel="h1"
        back={{ href: APP_ROUTES.dashboard, label: t("notFound.back") }}
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }
  const { competition, effects } = call.value;
  const { done } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title", { name: competition.name })}
        lead={t("lead")}
        className="wrap-anywhere"
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip status={competition.status} />
        <ButtonLink href={APP_ROUTES.adminCompetitions} variant="quiet">
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </ButtonLink>
      </div>
      {effects ? (
        <>
          <Effects effects={effects} />
          <CancelSection competition={competition} />
        </>
      ) : (
        <Cancelled competition={competition} justNow={done === "cancelled"} />
      )}
    </div>
  );
}

async function Effects({ effects }: { effects: CancellationEffects }) {
  const [page, t] = await Promise.all([
    getTranslations("competitionCancel"),
    getTranslations("competitionCancel.effects"),
  ]);
  return (
    <section aria-labelledby="cancel-effects" className={CARD}>
      <SectionHeading id="cancel-effects" title={page("effectsTitle")} />
      <ul className="mt-4 flex list-disc flex-col gap-2 ps-6 text-ink">
        <li>{t("told", { count: effects.registrationsTold })}</li>
        <li>{t("institutions", { count: effects.institutionsTold })}</li>
        <li>{t("cancelled", { count: effects.registrationsCancelled })}</li>
        <li>{t("gateway", { count: effects.gatewayRefunds })}</li>
        <li>{t("manual", { count: effects.manualRefunds })}</li>
        {effects.dashboardRefunds > 0 ? (
          <li>{t("dashboard", { count: effects.dashboardRefunds })}</li>
        ) : null}
        {effects.dashboardAmounts.map(({ currency, amountMinor }) => (
          <li key={currency}>
            {t("amountDashboard", {
              amount: formatCapturedAmount(amountMinor, currency),
            })}
          </li>
        ))}
        <li>
          {t(effects.dashboardRefunds > 0 ? "amountInr" : "amount", {
            amount: formatPaise(effects.refundMinor),
          })}
        </li>
      </ul>
    </section>
  );
}

async function CancelSection({
  competition,
}: {
  competition: CompetitionCancellation;
}) {
  const [t, callout] = await Promise.all([
    getTranslations("competitionCancel.form"),
    getTranslations("common.callout"),
  ]);
  const limit = { max: CANCEL_REASON_MAX_LENGTH };
  return (
    <section aria-labelledby="cancel-form" className={CARD}>
      <SectionHeading id="cancel-form" title={t("title")} />
      <p className="mt-3 text-ink">{t("lead")}</p>
      <div className="mt-5">
        <CancelForm
          competitionId={competition.id}
          labels={{
            reason: {
              label: t("reason.label"),
              hint: t("reason.hint", limit),
            },
            errors: {
              reason_invalid: t("errors.reason_invalid"),
              reason_required: t("errors.reason_required"),
              reason_too_long: t("errors.reason_too_long", limit),
            },
            alerts: {
              already_cancelled: t("alerts.already_cancelled"),
              not_found: t("alerts.not_found"),
              unexpected: t("alerts.unexpected"),
            },
            submit: t("submit"),
            saving: t("saving"),
            problem: callout("danger"),
          }}
        />
      </div>
    </section>
  );
}

async function Cancelled({
  competition,
  justNow,
}: {
  competition: CompetitionCancellation;
  justNow: boolean;
}) {
  const [t, format] = await Promise.all([
    getTranslations("competitionCancel.cancelled"),
    getFormatter(),
  ]);
  return (
    <>
      {justNow ? (
        <FormAlert tone="success" label={t("title")}>
          <p>{t("done")}</p>
        </FormAlert>
      ) : null}
      <section aria-labelledby="cancelled" className={CARD}>
        <SectionHeading id="cancelled" title={t("title")} />
        {competition.cancelledAt ? (
          <p className="mt-3 text-ink">
            {t("on", {
              at: format.dateTime(competition.cancelledAt, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        ) : null}
        {competition.cancelReason ? (
          <p className="mt-2 whitespace-pre-line text-ink wrap-anywhere">
            {t("reason", { reason: competition.cancelReason })}
          </p>
        ) : null}
        <p className="mt-2 text-ink">{t("next")}</p>
      </section>
    </>
  );
}
