import { getFormatter, getTranslations } from "next-intl/server";
import { SiteLink } from "@/components/site/site-link";
import type { ReactNode } from "react";

import { ContactFact } from "@/components/site/contact-fact";
import { PageHeader } from "@/components/site/heading";
import { InPageLink } from "@/components/site/in-page-link";
import { Placeholder } from "@/components/site/placeholder";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import {
  LEGAL_DOCS,
  type LegalBlock,
  type LegalDocId,
  type LegalFact,
  resolveLegalDoc,
  type ShownInline,
} from "@/content/legal";
import { isFactShown, type OrgFact, SITE } from "@/lib/site";

const LINK =
  "text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

const FACT_VALUE: Record<LegalFact, unknown> = {
  legalName: SITE.org.legalName,
  email: SITE.org.email,
  phone: SITE.org.phone,
  address: SITE.org.address,
  grievanceOfficerName: SITE.org.grievanceOfficer.name,
  grievanceOfficerEmail: SITE.org.grievanceOfficer.email,
};

/** A confirmed fact as text (or a mailto/tel link); else a visible placeholder. */
function Fact({ fact }: { fact: LegalFact }) {
  const value = FACT_VALUE[fact] as OrgFact;
  if (fact === "phone") return <ContactFact kind="phone" fact={value} />;
  if (fact.toLowerCase().includes("email"))
    return <ContactFact kind="email" fact={value} />;
  return <Placeholder fact={value} />;
}

function Inlines({ text }: { text: ShownInline[] }) {
  return text.map((i, k): ReactNode => {
    if (typeof i === "string") return i;
    if ("strong" in i) return <strong key={k}>{i.strong}</strong>;
    if ("fact" in i) return <Fact key={k} fact={i.fact} />;
    return (
      <SiteLink key={k} href={i.href} className={LINK}>
        {i.link}
      </SiteLink>
    );
  });
}

function BlockView({ block }: { block: LegalBlock<ShownInline> }) {
  if ("p" in block)
    return (
      <p>
        <Inlines text={block.p} />
      </p>
    );
  return (
    <ul>
      {block.list.map((item, k) => (
        <li key={k}>
          <Inlines text={item} />
        </li>
      ))}
    </ul>
  );
}

const NS = {
  privacy: "legal.privacy",
  terms: "legal.terms",
  safeguarding: "legal.safeguarding",
  childProtection: "legal.childProtection",
} as const;

/**
 * A policy page: header with a fixed "last updated" date, the short version
 * first, then the full text with a table of contents. `top` renders above
 * the short version (e.g. helplines); `after` adds content after a section.
 * In production, clauses about unconfirmed facts give way to their
 * production wording, and emptied sections go (resolveLegalDoc).
 */
export async function LegalDocument({
  id,
  top,
  after = {},
}: {
  id: LegalDocId;
  top?: ReactNode;
  after?: Partial<Record<string, ReactNode>>;
}) {
  const doc = resolveLegalDoc(LEGAL_DOCS[id], (fact) =>
    isFactShown(FACT_VALUE[fact])
  );
  const [t, tp, format] = await Promise.all([
    getTranslations("legal.common"),
    getTranslations(NS[id]),
    getFormatter(),
  ]);
  const shortTitle =
    id === "childProtection" ? tp("shortVersion") : t("shortVersion");

  return (
    <>
      <Section hue="neutral" tone="tint" className="pt-10 pb-12 sm:pt-14">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="blue"
          title={tp("title")}
          lead={tp("lead")}
        />
        <p className="mt-5 text-sm font-semibold text-ink-muted">
          {t("lastUpdated", {
            date: format.dateTime(new Date(doc.updated), "long"),
          })}
        </p>
      </Section>

      <Section hue="neutral" className="pt-10 sm:pt-12">
        {top}
        <section
          aria-labelledby="short-version"
          className="max-w-3xl rounded-3xl border-2 border-blue-700 bg-section-blue p-6 sm:p-8 dark:border-blue-400"
        >
          <h2
            id="short-version"
            className="flex items-center gap-2.5 font-display text-h4 leading-tight text-(--section-blue-heading)"
          >
            <TileMarker hue="blue" />
            {shortTitle}
          </h2>
          <ul className="mt-4 space-y-3 text-lead text-ink">
            {doc.short.map((point, k) => (
              <li key={k} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2.5 size-2.5 shrink-0 rounded-[22%] bg-blue-700 dark:bg-blue-400"
                />
                <span>
                  <Inlines text={point} />
                </span>
              </li>
            ))}
          </ul>
        </section>
        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
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
                {t("toc")}
              </p>
              <ol className="mt-3 space-y-1 text-sm">
                {doc.sections.map((s) => (
                  <li key={s.id}>
                    <InPageLink
                      href={`#${s.id}`}
                      className="flex min-h-8 items-center rounded-lg px-2 text-ink hover:bg-surface-muted hover:text-link"
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
              {doc.sections.map((s) => (
                <section key={s.id} aria-labelledby={s.id}>
                  <h2 id={s.id}>{s.title}</h2>
                  {s.blocks.map((b, k) => (
                    <div key={k} className="mt-4">
                      <BlockView block={b} />
                    </div>
                  ))}
                  {after[s.id] ? (
                    <div className="mt-6">{after[s.id]}</div>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
