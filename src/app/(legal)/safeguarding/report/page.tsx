import { ImageOff, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { CONTACT_LINK } from "@/components/site/contact-fact";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { contactHref } from "@/lib/contact";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import {
  CONCERN_CATEGORIES,
  DESCRIPTION_MAX,
  REPORTER_CONTACT_MAX,
  REPORTER_NAME_MAX,
  SUBJECT_AGE_MAX,
  SUBJECT_DETAILS_MAX,
} from "@/server/modules/safeguarding/domain/concern";

import { ConcernForm } from "./_components/concern-form";
import { HelpContacts } from "./_components/help-contacts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("safeguardingReport.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.safeguardingReport.path,
  });
}

const SAFETY_LINE = `${CONTACT_LINK} font-semibold`;
const call = (number: string) => (chunks: ReactNode) => (
  <a href={contactHref("phone", number)} className={SAFETY_LINE}>
    {chunks}
  </a>
);

const BOX = "rounded-3xl border-2 p-5 sm:p-6";

/** Ages a reporter can pick for the child; blank means "I don't know". */
const AGES = Array.from({ length: SUBJECT_AGE_MAX + 1 }, (_, age) => age);

/**
 * The public "report a concern" form (#116): prerendered, with the form as
 * an island. It works without an account and without a name. The Quick
 * exit bar comes from the @exit slot (src/app/@exit/safeguarding/report).
 * No attachments: images of abuse go to cybercrime.gov.in instead.
 */
export default async function Page() {
  const [t, tc] = await Promise.all([
    getTranslations("safeguardingReport"),
    getTranslations("common.callout"),
  ]);
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="red"
        title={t("title")}
        lead={t("lead")}
      />
      <aside
        aria-labelledby="danger-title"
        className={`${BOX} mt-8 border-danger-border bg-danger-bg`}
      >
        <h2
          id="danger-title"
          className="flex items-center gap-2 font-sans text-lead font-bold text-danger"
        >
          <ShieldAlert aria-hidden="true" className="size-6 shrink-0" />
          {t("danger.title")}
        </h2>
        <p className="mt-2 text-ink">
          {t.rich("danger.body", {
            emergency: call("112"),
            childline: call("1098"),
          })}
        </p>
      </aside>
      <aside
        aria-labelledby="images-title"
        className={`${BOX} mt-4 border-border bg-surface`}
      >
        <h2
          id="images-title"
          className="flex items-center gap-2 font-sans text-lead font-bold text-ink"
        >
          <ImageOff aria-hidden="true" className="size-6 shrink-0" />
          {t("images.title")}
        </h2>
        <p className="mt-2 text-ink">
          {t.rich("images.body", {
            cyberLine: call("1930"),
            cyberSite: (chunks) => (
              <a
                href="https://cybercrime.gov.in"
                rel="noreferrer"
                className={SAFETY_LINE}
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </aside>

      <section
        aria-labelledby="form-title"
        className="mt-10 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8"
      >
        <SectionHeading id="form-title" title={t("formTitle")} />
        <div className="mt-6">
          <ConcernForm
            labels={{
              category: { legend: t("form.category.legend") },
              description: {
                label: t("form.description.label"),
                hint: t("form.description.hint"),
              },
              subjectDetails: {
                label: t("form.subjectDetails.label"),
                hint: t("form.subjectDetails.hint"),
              },
              subjectAge: {
                label: t("form.subjectAge.label"),
                unknown: t("form.subjectAge.unknown"),
              },
              reporterIsChild: t("form.reporterIsChild"),
              anonymous: {
                label: t("form.anonymous.label"),
                hint: t("form.anonymous.hint"),
              },
              reporterName: { label: t("form.reporterName.label") },
              reporterContact: {
                label: t("form.reporterContact.label"),
                hint: t("form.reporterContact.hint"),
              },
              honeypot: t("form.honeypot"),
              privacy: t("form.privacy"),
              privacyLink: t("form.privacyLink"),
              send: t("form.send"),
              sending: t("form.sending"),
              problem: tc("danger"),
            }}
            categories={CONCERN_CATEGORIES.map((category) => ({
              value: category,
              label: t(`form.category.options.${category}`),
            }))}
            ages={AGES.map((age) => ({
              value: String(age),
              label: t("form.subjectAge.age", { age }),
            }))}
            limits={{
              description: DESCRIPTION_MAX,
              subjectDetails: SUBJECT_DETAILS_MAX,
              reporterName: REPORTER_NAME_MAX,
              reporterContact: REPORTER_CONTACT_MAX,
            }}
            help={<HelpContacts />}
          />
        </div>
      </section>
    </Section>
  );
}
