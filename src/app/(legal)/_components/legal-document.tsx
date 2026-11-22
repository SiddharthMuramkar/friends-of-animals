import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import {
  LegalBlockView,
  LegalInlines,
  shownLegalDoc,
} from "@/components/legal/legal-text";
import { PageHeader } from "@/components/site/heading";
import { InPageLink } from "@/components/site/in-page-link";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import {
  LEGAL_DOCS,
  type LegalDoc,
  type LegalDocId,
  type ShownInline,
} from "@/content/legal";
import type {
  ConsentPurpose,
  PublishedConsentDocument,
} from "@/server/modules/consent";
import { cachedConsentDocument } from "@/server/modules/consent/cached";
import { nullIfUnreadable } from "@/server/modules/consent/unreadable";

const NS = {
  privacy: "legal.privacy",
  terms: "legal.terms",
  safeguarding: "legal.safeguarding",
  childProtection: "legal.childProtection",
} as const;

type LegalText = Pick<LegalDoc<ShownInline>, "short" | "sections">;

/**
 * A policy page: header, a "last updated" line, the short version first,
 * then the full text with a table of contents. `top` renders above the
 * short version (e.g. helplines); `after` adds content after a section.
 * In production, the repo text's clauses about unconfirmed facts give way
 * to their production wording, and emptied sections go (shownLegalDoc).
 *
 * With `purpose`, the page shows the current published version of that
 * consent document and its number (#64). The header stays in the static
 * shell; the date line and the text are dynamic holes that fall back to
 * the repo's text, which is also what shows before version 1 exists.
 */
export async function LegalDocument({
  id,
  purpose,
  top,
  after = {},
}: {
  id: LegalDocId;
  purpose?: ConsentPurpose;
  top?: ReactNode;
  after?: Partial<Record<string, ReactNode>>;
}) {
  const doc = shownLegalDoc(LEGAL_DOCS[id]);
  const [t, tp] = await Promise.all([
    getTranslations("legal.common"),
    getTranslations(NS[id]),
  ]);
  const shortTitle =
    id === "childProtection" ? tp("shortVersion") : t("shortVersion");
  const repoDate = <UpdatedLine updated={new Date(doc.updated)} />;
  const repoText = (
    <LegalBody
      text={doc}
      shortTitle={shortTitle}
      tocTitle={t("toc")}
      top={top}
      after={after}
    />
  );

  return (
    <>
      <Section hue="neutral" tone="tint" className="pt-10 pb-12 sm:pt-14">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="blue"
          title={tp("title")}
          lead={tp("lead")}
        />
        {purpose ? (
          <Suspense fallback={repoDate}>
            <Published purpose={purpose} fallback={repoDate}>
              {(published) => (
                <UpdatedLine
                  updated={published.publishedAt}
                  version={published.version}
                />
              )}
            </Published>
          </Suspense>
        ) : (
          repoDate
        )}
      </Section>

      {purpose ? (
        <Suspense fallback={repoText}>
          <Published purpose={purpose} fallback={repoText}>
            {(published) => (
              <LegalBody
                text={published.body}
                shortTitle={shortTitle}
                tocTitle={t("toc")}
                top={top}
                after={after}
              />
            )}
          </Published>
        </Suspense>
      ) : (
        repoText
      )}
    </>
  );
}

/**
 * Renders `children` with the purpose's current published version, read
 * at request time, or `fallback` while none is published. If the database
 * can't be read, the page keeps the repo's text rather than failing: a
 * policy page must always be readable.
 */
async function Published({
  purpose,
  fallback,
  children,
}: {
  purpose: ConsentPurpose;
  fallback: ReactNode;
  children: (published: PublishedConsentDocument) => ReactNode;
}) {
  await connection();
  const published = await nullIfUnreadable(
    `Legal page: could not read the published ${purpose}`,
    () => cachedConsentDocument(purpose)
  );
  return published ? children(published) : fallback;
}

async function UpdatedLine({
  updated,
  version,
}: {
  updated: Date;
  version?: number;
}) {
  const [t, format] = await Promise.all([
    getTranslations("legal.common"),
    getFormatter(),
  ]);
  const date = format.dateTime(updated, "long");
  return (
    <p className="mt-5 text-sm font-semibold text-ink-muted">
      {version === undefined
        ? t("lastUpdated", { date })
        : t("versionUpdated", { version, date })}
    </p>
  );
}

function LegalBody({
  text,
  shortTitle,
  tocTitle,
  top,
  after,
}: {
  text: LegalText;
  shortTitle: string;
  tocTitle: string;
  top?: ReactNode;
  after: Partial<Record<string, ReactNode>>;
}) {
  return (
    <Section hue="neutral" className="pt-10 sm:pt-12">
      {top}
      <section
        aria-labelledby="short-version"
        className="max-w-3xl rounded-3xl border-2 border-blue-700 bg-section-blue px-4 py-6 sm:p-8 dark:border-blue-400"
      >
        <h2
          id="short-version"
          className="flex items-center gap-2.5 font-display text-h4 leading-tight text-(--section-blue-heading)"
        >
          <TileMarker hue="blue" />
          <span className="min-w-0">{shortTitle}</span>
        </h2>
        <ul className="mt-4 space-y-3 text-lead text-ink">
          {text.short.map((point, k) => (
            <li key={k} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-2.5 size-2.5 shrink-0 rounded-[22%] bg-blue-700 dark:bg-blue-400"
              />
              <span className="min-w-0">
                <LegalInlines text={point} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
        <nav
          aria-labelledby="legal-toc"
          className="lg:sticky lg:top-[calc(var(--header-height)+var(--quick-exit-offset,0px)+1.5rem)] lg:order-2 lg:self-start"
        >
          <div className="rounded-3xl border-2 border-border bg-surface p-5">
            <p
              id="legal-toc"
              className="flex items-center gap-2 font-display text-lead font-semibold"
            >
              <TileMarker hue="blue" size="sm" />
              {tocTitle}
            </p>
            <ol className="mt-3 space-y-1 text-sm">
              {text.sections.map((s) => (
                <li key={s.id}>
                  <InPageLink
                    href={`#${s.id}`}
                    className="flex min-h-8 items-center rounded-lg px-2 text-ink hover:bg-surface-muted hover:text-link pointer-coarse:min-h-11"
                  >
                    {s.title}
                  </InPageLink>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="min-w-0 lg:order-1">
          <div className="prose-foa">
            {text.sections.map((s) => (
              <section key={s.id} aria-labelledby={s.id}>
                <h2 id={s.id}>{s.title}</h2>
                {s.blocks.map((b, k) => (
                  <div key={k} className="mt-4">
                    <LegalBlockView block={b} />
                  </div>
                ))}
                {after[s.id] ? <div className="mt-6">{after[s.id]}</div> : null}
              </section>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
