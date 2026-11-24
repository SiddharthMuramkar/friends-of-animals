import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { Section } from "@/components/site/section";
import {
  ADMIN_PAYMENTS_REVIEW,
  adminPaymentReviewCasePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  PAYMENT_REVIEW_OUTCOMES,
  type PaymentReviewOutcome,
} from "@/server/modules/payments/domain/review-case";

import { adminCall } from "../../../_lib/boundary";
import { PaymentsDenied } from "../../_components/payments-denied";
import { ReviewCaseView } from "./_components/review-case-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPayments.case.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/payments/review/[id]">;

/**
 * One payment needing review (#79): what arrived, why it couldn't be
 * accepted, and the decision staff take on it with a reason. Finance,
 * staff admins and super admins.
 */
export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminPayments");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <ButtonLink
        href={ADMIN_PAYMENTS_REVIEW}
        variant="quiet"
        className="-ms-5 mb-4"
      >
        {t("case.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <ReviewCase params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function ReviewCase({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const call = await adminCall(
    () => as(actor).getPaymentReviewCase({ caseId: id }),
    adminPaymentReviewCasePath(id)
  );
  if (!call.ok) return <PaymentsDenied headingLevel="h1" />;
  const t = await getTranslations("adminPayments");
  if (!call.value.ok) {
    return (
      <ExplainState
        title={t("case.notFound.title")}
        headingLevel="h1"
        back={{
          href: ADMIN_PAYMENTS_REVIEW,
          label: t("case.notFound.back"),
        }}
      >
        <p>{t("case.notFound.body")}</p>
      </ExplainState>
    );
  }
  const { reviewCase } = call.value;
  const { done, record } = await searchParams;
  const outcome =
    typeof done === "string" &&
    (PAYMENT_REVIEW_OUTCOMES as readonly string[]).includes(done)
      ? (done as PaymentReviewOutcome)
      : undefined;
  return (
    <ReviewCaseView
      reviewCase={reviewCase}
      outcome={outcome}
      recordError={
        record === "invalid_reference" ||
        record === "unexpected" ||
        record === "refund_unverified" ||
        record === "reference_already_recorded"
          ? record
          : undefined
      }
    />
  );
}
