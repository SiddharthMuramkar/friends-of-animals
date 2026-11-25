import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { SectionHeading } from "@/components/site/heading";
import { Live } from "@/components/site/live";
import { ROUTES } from "@/lib/routes";
import type { DonationTerms } from "@/server/modules/donations/terms";

import { PRESET_RUPEES } from "../_lib/donate-input";
import { rupeesText } from "../_lib/rupees";
import { loadDonationTerms } from "../_lib/terms";
import { DonateForm, type DonateFormLabels } from "./donate-form";

/**
 * Where the donate page takes a gift (#106): the form while online giving
 * is open (the `donations.enabled` setting), and the honest "not open yet"
 * otherwise, which is what production shows until Razorpay's live keys
 * and the accountant's receipts are in place (HR-15, HR-47). Read at
 * request time, so the build needs no database: the static shell holds a
 * one-line placeholder, with nothing to tap, until the terms stream in.
 */
export async function DonateSection() {
  const [t, callout] = await Promise.all([
    getTranslations("donate"),
    getTranslations("common.callout"),
  ]);
  return (
    <Live<DonationTerms | null> fallback={null} load={loadDonationTerms}>
      {(terms) =>
        terms === null ? (
          <p className="text-center text-ink-muted">{t("form.loading")}</p>
        ) : (
          <Terms terms={terms} t={t} problem={callout("danger")} />
        )
      }
    </Live>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations<"donate">>>;

function Terms({
  terms,
  t,
  problem,
}: {
  terms: DonationTerms;
  t: Translator;
  problem: string;
}) {
  if (!terms.open) {
    return (
      <ExplainState
        title={t("notLive.title")}
        back={{ href: ROUTES.contact.path, label: t("notLive.back") }}
        art="wait-horizon-myna"
        className="mx-auto max-w-3xl"
      >
        <p>{t("notLive.body")}</p>
        <p>{t("notLive.rules")}</p>
      </ExplainState>
    );
  }
  const range = {
    min: rupeesText(terms.minAmountMinor),
    max: rupeesText(terms.maxAmountMinor),
  };
  const labels: DonateFormLabels = {
    amount: {
      legend: t("form.amount.legend"),
      presets: Object.fromEntries(
        PRESET_RUPEES.map((rupees) => [
          String(rupees),
          t("form.amount.preset", {
            amount: rupeesText(BigInt(rupees) * 100n),
          }),
        ])
      ),
      other: t("form.amount.other"),
      otherLabel: t("form.amount.otherLabel"),
      otherHint: t("form.amount.otherHint", range),
    },
    donorType: {
      legend: t("form.donorType.legend"),
      individual: t("form.donorType.individual"),
      corporate: t("form.donorType.corporate"),
      csr: t("form.donorType.csr"),
    },
    name: { label: t("form.name.label"), hint: t("form.name.hint") },
    contactName: {
      label: t("form.contactName.label"),
      hint: t("form.contactName.hint"),
    },
    email: { label: t("form.email.label"), hint: t("form.email.hint") },
    pan: { label: t("form.pan.label"), hint: t("form.pan.hint") },
    organisation: {
      label: t("form.organisation.label"),
      hint: t("form.organisation.hint"),
    },
    disclose: {
      legend: t("form.disclose.legend"),
      hint: t("form.disclose.hint"),
      yes: t("form.disclose.yes"),
      no: t("form.disclose.no"),
    },
    wall: {
      label: t("form.wall.label"),
      hint: t("form.wall.hint"),
      nameLabel: t("form.wall.nameLabel"),
      nameHint: t("form.wall.nameHint"),
    },
    declarations: {
      legend: t("form.declarations.legend"),
      adult: t("form.declarations.adult"),
      indian: t("form.declarations.indian"),
    },
    submit: t("form.submit"),
    submitting: t("form.submitting"),
    privacy: t("form.privacy"),
    privacyLink: t("form.privacyLink"),
    privacyHref: ROUTES.privacy.path,
    minor: {
      title: t("form.minor.title"),
      back: t("form.minor.back"),
      backHref: ROUTES.competitions.path,
    },
    problem,
  };
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8">
      <SectionHeading
        id="give-title"
        title={t("form.title")}
        lead={t("form.lead")}
      />
      <div className="mt-8">
        <DonateForm labels={labels} has80G={terms.has80G} />
      </div>
    </div>
  );
}
