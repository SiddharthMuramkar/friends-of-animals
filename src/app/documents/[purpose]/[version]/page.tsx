import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { pageMetadata } from "@/lib/seo";
import { parseDocumentVersionPath } from "@/server/modules/competitions/domain/consent-attachments";
import { cachedCompetitionDocumentVersion } from "@/server/modules/competitions/terms/cached";

export async function generateMetadata({
  params,
}: PageProps<"/documents/[purpose]/[version]">): Promise<Metadata> {
  const [t, { purpose, version }] = await Promise.all([
    getTranslations("competitionTerms.documentPage.meta"),
    params,
  ]);
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: `/documents/${purpose}/${version}`,
  });
}

/**
 * One exact version of a document a competition pins (#72): what its
 * public terms link to, so people read the text they agree to even after
 * a newer version is published. The shell is static; the version is read
 * at request time.
 */
export default async function Page({
  params,
}: PageProps<"/documents/[purpose]/[version]">) {
  const t = await getTranslations("competitionTerms.documentPage");
  return (
    <Suspense
      fallback={
        <Section hue="neutral" tone="tint" className="pt-10 pb-12 sm:pt-14">
          <PageHeader
            eyebrow={t("eyebrow")}
            tile="blue"
            title={t("meta.title")}
            lead={t("loading")}
          />
        </Section>
      }
    >
      {params.then(({ purpose, version }) => (
        <DocumentVersion purposeSegment={purpose} versionSegment={version} />
      ))}
    </Suspense>
  );
}

async function DocumentVersion({
  purposeSegment,
  versionSegment,
}: {
  purposeSegment: string;
  versionSegment: string;
}) {
  await connection();
  const named = parseDocumentVersionPath(purposeSegment, versionSegment);
  if (!named) notFound();
  const [document, t, format] = await Promise.all([
    cachedCompetitionDocumentVersion(named.purpose, named.version),
    getTranslations("competitionTerms.documentPage"),
    getFormatter(),
  ]);
  if (!document) notFound();

  return (
    <>
      <Section hue="neutral" tone="tint" className="pt-10 pb-12 sm:pt-14">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="blue"
          title={document.title}
          lead={t("lead")}
        />
        <p className="mt-5 text-sm font-semibold text-ink-muted">
          {t("version", {
            version: document.version,
            date: format.dateTime(document.publishedAt, "long"),
          })}
        </p>
      </Section>
      <Section hue="neutral" className="pt-10 sm:pt-12">
        <div className="max-w-3xl">
          {document.body.short.length > 0 ? (
            <section
              aria-labelledby="short-version"
              className="mb-10 rounded-3xl border-2 border-border bg-surface p-6 sm:p-8"
            >
              <h2 id="short-version" className="font-display text-h4">
                {t("shortVersion")}
              </h2>
              <LegalShortList
                points={document.body.short}
                className="mt-4 list-disc space-y-2 pl-5 text-lead"
              />
            </section>
          ) : null}
          <LegalSectionsText sections={document.body.sections} level="h2" />
        </div>
      </Section>
    </>
  );
}
