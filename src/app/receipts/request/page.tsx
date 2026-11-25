import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SubmitButton, TextField } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";

import { requestReceiptLinkAction } from "./_lib/actions";

// Asking for a new receipt link (#106): a donor who lost the email, or
// whose link expired, gives their email and receipt number, and a match
// gets a new 7-day link by email. Works without JavaScript: the form posts
// to a Server Action that comes back here saying what happened.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("receipts.meta");
  return { title: t("requestTitle"), robots: { index: false, follow: false } };
}

const HUE = ROUTES.donate.hue;
const OUTCOMES = ["sent", "invalid", "limited", "failed"] as const;

type Props = PageProps<"/receipts/request">;

export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("receipts.request");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense fallback={null}>
        <Outcome searchParams={searchParams} />
      </Suspense>
      <form
        action={requestReceiptLinkAction}
        className="mt-8 flex flex-col gap-6 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
      >
        <TextField
          id="receipt-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          label={t("email.label")}
        />
        <TextField
          id="receipt-number"
          name="receiptNumber"
          required
          maxLength={40}
          autoComplete="off"
          label={t("number.label")}
          hint={t("number.hint")}
        />
        <div>
          <SubmitButton pendingLabel={t("submitting")}>
            {t("submit")}
          </SubmitButton>
        </div>
      </form>
    </Section>
  );
}

async function Outcome({ searchParams }: Pick<Props, "searchParams">) {
  const [query, t, callout] = await Promise.all([
    searchParams,
    getTranslations("receipts.request"),
    getTranslations("common.callout"),
  ]);
  const done = OUTCOMES.find((each) => each === query["done"]);
  if (!done) return null;
  const message = {
    sent: t("sent"),
    invalid: t("invalid"),
    limited: t("rateLimited"),
    failed: t("failed"),
  }[done];
  const tone = done === "sent" ? "success" : "danger";
  return (
    <div className="mt-8">
      <OutcomeNotice tone={tone} label={callout(tone)} message={message} />
    </div>
  );
}
