import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { LEGAL_FACTS, type LegalFact } from "@/content/legal";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { isMirroredConsentPurpose } from "@/server/modules/cms/domain/documents";
import type {
  ConsentDocumentVersion,
  ConsentPurpose,
} from "@/server/modules/consent";
import { formatConsentDocumentSource } from "@/server/modules/consent/domain/document-source";
import { CONSENT_PURPOSES } from "@/server/modules/consent/domain/purposes";
import { DomainError } from "@/server/errors";

import { PublishForm } from "./_components/publish-form";
import { PublishedNotice } from "./_components/published-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("consentAdmin.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = Promise<{ published?: string | string[] }>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("consentAdmin");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* Who is asking, and the documents, are read per request, so they
          stream in behind this boundary while the heading is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Documents searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8";

/** `<purpose>-<version>-<token>`, from the action's redirect. */
function publishedOf(published: string | string[] | undefined) {
  if (typeof published !== "string") return null;
  const match = /^([a-z_]+)-(\d+)-/.exec(published);
  const purpose = CONSENT_PURPOSES.find((each) => each === match?.[1]);
  return purpose && match
    ? { purpose, version: Number(match[2]), key: published }
    : null;
}

/** Every purpose's versions, newest first; null if the actor may not see them. */
async function versionsFor(
  actor: Awaited<ReturnType<typeof currentActor>>
): Promise<Record<ConsentPurpose, ConsentDocumentVersion[]> | null> {
  try {
    const lists = await Promise.all(
      CONSENT_PURPOSES.map((purpose) =>
        as(actor).listConsentDocumentVersions({ purpose })
      )
    );
    return Object.fromEntries(
      CONSENT_PURPOSES.map((purpose, k) => [purpose, lists[k] ?? []])
    ) as Record<ConsentPurpose, ConsentDocumentVersion[]>;
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") return null;
    throw error;
  }
}

async function Documents({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, tf, callout, format, versions, { published }] = await Promise.all([
    getTranslations("consentAdmin"),
    getTranslations("consentAdmin.form"),
    getTranslations("common.callout"),
    getFormatter(),
    versionsFor(actor),
    searchParams,
  ]);

  if (!versions) {
    return (
      <ExplainState
        title={t("denied.title")}
        back={{ href: APP_ROUTES.accountSessions, label: t("denied.back") }}
        className="mt-8"
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }

  const notice = publishedOf(published);
  const date = (at: Date) => format.dateTime(at, "long");
  const factLabels = Object.fromEntries(
    LEGAL_FACTS.map((fact) => [fact, tf("fact", { fact })])
  ) as Record<LegalFact, string>;
  const publishedLine = (version: ConsentDocumentVersion) =>
    version.publishedBy
      ? t("versionPublished", {
          date: date(version.publishedAt),
          name: version.publishedBy.name,
        })
      : t("versionSeeded", { date: date(version.publishedAt) });

  return (
    <div className="mt-8 flex flex-col gap-8">
      {CONSENT_PURPOSES.map((purpose) => {
        const all = versions[purpose];
        const current = all[0];
        const nextVersion = (current?.version ?? 0) + 1;
        return (
          <section
            key={purpose}
            aria-labelledby={`purpose-${purpose}`}
            className={CARD}
          >
            <h2 id={`purpose-${purpose}`} className="text-h3">
              {t(`purposes.${purpose}`)}
            </h2>
            <p className="mt-2 text-ink-muted">
              {current
                ? current.publishedBy
                  ? t("current", {
                      version: current.version,
                      date: date(current.publishedAt),
                      name: current.publishedBy.name,
                    })
                  : t("currentSeeded", {
                      version: current.version,
                      date: date(current.publishedAt),
                    })
                : t("none")}
            </p>

            {notice?.purpose === purpose ? (
              <div className="mt-5">
                <PublishedNotice
                  key={notice.key}
                  label={callout("success")}
                  message={t("published", { version: notice.version })}
                />
              </div>
            ) : null}

            {isMirroredConsentPurpose(purpose) ? (
              // Its policy page's text: the CMS publishes it (#111).
              <p className="mt-4 max-w-prose">{t("fromCms")}</p>
            ) : (
              <div className="mt-6">
                <PublishForm
                  // A new current version resets the form to its text.
                  key={current?.id ?? "none"}
                  purpose={purpose}
                  defaults={{
                    title: current?.title ?? t(`purposes.${purpose}`),
                    source: current
                      ? formatConsentDocumentSource(current.body)
                      : "",
                  }}
                  labels={{
                    title: tf("title.label"),
                    source: {
                      label: tf("source.label"),
                      hint: tf("source.hint"),
                    },
                    preview: tf("preview"),
                    previewing: tf("previewing"),
                    publish: tf("publish", { version: nextVersion }),
                    publishing: tf("publishing"),
                    previewTitle: tf("previewTitle", { version: nextVersion }),
                    fixErrors: tf("fixErrors"),
                    problem: callout("danger"),
                  }}
                  factLabels={factLabels}
                />
              </div>
            )}

            {current ? (
              <div className="mt-8">
                <h3 className="text-lead font-bold text-ink">{t("history")}</h3>
                <ul className="mt-3 flex flex-col gap-3">
                  {all.map((version) => (
                    <li key={version.id}>
                      <Disclosure
                        summary={t("versionSummary", {
                          version: version.version,
                          title: version.title,
                        })}
                      >
                        <p className="text-sm text-ink-muted">
                          {publishedLine(version)}
                        </p>
                        <LegalShortList
                          points={version.body.short}
                          className="list-disc space-y-1 pl-5"
                        />
                        <LegalSectionsText
                          sections={version.body.sections}
                          level="h4"
                        />
                      </Disclosure>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
