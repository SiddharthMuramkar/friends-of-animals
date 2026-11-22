import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { feeText } from "@/components/competitions/fee-text";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { TableScroller } from "@/components/site/table-scroller";
import {
  APP_ROUTES,
  institutionCompetitionsPath,
  institutionRegistrationPath,
  payFeesPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import type { PaymentBatchStatus } from "@/server/modules/payments";
import type { RegistrationStatus } from "@/server/modules/registration";

import {
  actingInstitutions,
  chooseInstitution,
} from "../../../../competitions/_lib/register-state";

// A payment batch's status and receipt (#77): what it charged, whether it
// is paid, and each student it paid for with their registration number.
// The Checkout return lands here. A batch still waiting for payment links
// back to the pay page, which asks the gateway about the open order before
// anything else; reading this page changes nothing.

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.batch.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/payments/[batchId]">;

export default async function Page({ params, searchParams }: Props) {
  await connection();
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Header />
      {/* The batch streams in behind this boundary. */}
      <Suspense fallback={<Loading />}>
        <Batch params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Header() {
  const t = await getTranslations("payments.batch");
  return <PageHeader eyebrow={t("eyebrow")} tile="pink" title={t("title")} />;
}

async function Loading() {
  const t = await getTranslations("payments.batch");
  return <p className="mt-8 text-ink-muted">{t("loading")}</p>;
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const BATCH_TONE = {
  created: "neutral",
  order_created: "marigold",
  captured: "green",
  failed: "neutral",
  cancelled: "neutral",
} as const satisfies Record<PaymentBatchStatus, string>;

const STUDENT_TONE = {
  enrolled: "green",
  confirmed: "blue",
  withdrawn: "neutral",
  // The individual route's (#78); never in a school's batch.
  pending_payment: "marigold",
} as const satisfies Record<RegistrationStatus, string>;

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

async function Batch({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ batchId }, query, t, statuses, format, access] = await Promise.all([
    params,
    searchParams,
    getTranslations("payments.batch"),
    getTranslations("registration.status"),
    getFormatter(),
    as(actor).myAccess(),
  ]);

  const institutionId = chooseInstitution(
    actingInstitutions(access.grants),
    param(query.institution)
  );
  if (!institutionId) {
    return (
      <ExplainState
        className="mt-8"
        title={t("noInstitution.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("noInstitution.back") }}
      >
        <p>{t("noInstitution.body")}</p>
      </ExplainState>
    );
  }
  const result = await as(actor).getPaymentBatch({ institutionId, batchId });
  if (!result.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("notFound.title")}
        back={{
          href: institutionCompetitionsPath(institutionId),
          label: t("notFound.back"),
        }}
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const { batch } = result;
  const amount = feeText(
    {
      route: "institution",
      kind: "amount",
      paise: batch.amount.amountMinor.toString(),
    },
    {
      t: () => "",
      format: { number: (value, name) => format.number(value, name) },
    }
  );

  return (
    <div className="mt-8 flex flex-col gap-8">
      <div>
        <p className="text-lead font-semibold text-ink wrap-anywhere">
          {t("for", { competition: batch.competition.name })}
        </p>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {t("reference", { reference: batch.reference })}
        </p>
      </div>

      <section aria-labelledby="batch-summary" className={CARD}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SectionHeading id="batch-summary" title={t("summaryTitle")} />
          <Chip tone={BATCH_TONE[batch.status]}>
            {t(`status.${batch.status}`)}
          </Chip>
        </div>
        <p className="mt-3 text-ink">
          {batch.status === "captured" && batch.capturedAt
            ? t("statusBody.captured", {
                date: format.dateTime(batch.capturedAt, "long"),
              })
            : t(`statusBody.${batch.status}`)}
        </p>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-ink">
          <dt>{t("amount")}</dt>
          <dd className="text-end font-display font-semibold">{amount}</dd>
          <dt>{t("students")}</dt>
          <dd className="text-end font-semibold">{batch.items.length}</dd>
          {/* Which adapter made the order, so a tester can tell a test
              payment from a real one; journeys read data-gateway (#77). */}
          <dt>{t("gateway")}</dt>
          <dd className="text-end" data-gateway={batch.gateway}>
            {t(`gatewayName.${batch.gateway}`)}
          </dd>
        </dl>
        {batch.checkout ? (
          // A full load: the pay page's CSP comes with its document.
          <a
            href={payFeesPath(batch.reference, institutionId)}
            className={cn(buttonStyles({ variant: "primary" }), "mt-5")}
          >
            {t("payNow")}
          </a>
        ) : null}
      </section>

      <TableScroller captionId="batch-students">
        <table className="w-full text-left">
          <caption
            id="batch-students"
            className="px-5 pt-4 text-left text-h3 font-semibold"
          >
            {t("studentsTitle")}
          </caption>
          <thead className="bg-surface-muted text-sm">
            <tr>
              <th scope="col" className="px-5 py-3">
                {t("student")}
              </th>
              <th scope="col" className="px-5 py-3">
                {t("studentStatus")}
              </th>
              <th scope="col" className="px-5 py-3">
                {t("number")}
              </th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((item) => (
              <tr
                key={item.registrationId}
                className="border-t border-border align-top"
              >
                <th
                  scope="row"
                  className="px-5 py-4 font-semibold wrap-anywhere"
                >
                  {item.fullName}
                </th>
                <td className="px-5 py-4">
                  <Chip tone={STUDENT_TONE[item.status]}>
                    {statuses(item.status)}
                  </Chip>
                </td>
                <td className="px-5 py-4 font-mono">
                  {item.registrationNumber ?? (
                    <span className="font-sans text-ink-muted">
                      {t("noNumber")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      <p>
        <ButtonLink
          href={institutionRegistrationPath(batch.reference, institutionId)}
          variant="quiet"
          className="-ms-5"
        >
          {t("back")}
        </ButtonLink>
      </p>
    </div>
  );
}
