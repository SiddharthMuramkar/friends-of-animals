import type { ReactNode } from "react";

import { ContactFact } from "@/components/site/contact-fact";
import { Placeholder } from "@/components/site/placeholder";
import { SiteLink } from "@/components/site/site-link";
import { WithOrgFacts } from "@/components/site/with-org-facts";
import {
  type LegalBlock,
  type LegalDoc,
  type LegalFact,
  resolveLegalDoc,
  type ShownInline,
} from "@/content/legal";
import { isFactShown } from "@/lib/site";
import {
  legalFactValue,
  type OrgFacts,
  unconfirmedOrgFacts,
} from "@/server/modules/cms/domain/org-facts";
import { linkRel } from "@/server/rich-text/href";

// The typed blocks of a policy or consent document as HTML: the policy
// pages draw the repo's text and the published versions with these, so
// the two always look the same. Server Components (facts read their
// "to be confirmed" words on the server). They draw text as shown, with
// no clauses left: a published version has none, and the repo's text
// goes through shownLegalDoc first.

const LINK =
  "text-link wrap-anywhere underline decoration-1 underline-offset-2 hover:text-link-hover";

/**
 * A repo policy as this deployment shows it: in production, clauses about
 * facts FOA hasn't confirmed give way to their production wording, and
 * emptied sections go (resolveLegalDoc). `facts` defaults to none
 * confirmed: what the static shell, built without a database, knows.
 */
export function shownLegalDoc(
  doc: LegalDoc,
  facts: OrgFacts = unconfirmedOrgFacts()
): LegalDoc<ShownInline> {
  return resolveLegalDoc(doc, (fact) =>
    isFactShown(legalFactValue(facts, fact))
  );
}

/** A confirmed fact as text (or a mailto/tel link); else a visible placeholder. */
function Fact({ fact }: { fact: LegalFact }) {
  return (
    <WithOrgFacts>
      {(facts) => {
        const value = legalFactValue(facts, fact);
        if (fact === "phone") return <ContactFact kind="phone" fact={value} />;
        if (fact.toLowerCase().includes("email"))
          return <ContactFact kind="email" fact={value} />;
        return <Placeholder fact={value} />;
      }}
    </WithOrgFacts>
  );
}

/**
 * One run of text with its strong words, links and facts. A link to
 * another site is a plain <a> whose rel (linkRel) stops it reaching back
 * through window.opener, sending a referrer or passing search rank.
 */
export function LegalInlines({ text }: { text: ShownInline[] }) {
  return text.map((i, k): ReactNode => {
    if (typeof i === "string") return i;
    if ("strong" in i) return <strong key={k}>{i.strong}</strong>;
    if ("fact" in i) return <Fact key={k} fact={i.fact} />;
    const rel = linkRel(i.href);
    if (rel) {
      return (
        <a key={k} href={i.href} rel={rel} className={LINK}>
          {i.link}
        </a>
      );
    }
    return (
      <SiteLink key={k} href={i.href} className={LINK}>
        {i.link}
      </SiteLink>
    );
  });
}

/** A paragraph or a list. */
export function LegalBlockView({ block }: { block: LegalBlock<ShownInline> }) {
  if ("p" in block)
    return (
      <p>
        <LegalInlines text={block.p} />
      </p>
    );
  return (
    <ul>
      {block.list.map((item, k) => (
        <li key={k}>
          <LegalInlines text={item} />
        </li>
      ))}
    </ul>
  );
}

type Sections = {
  id: string;
  title: string;
  blocks: LegalBlock<ShownInline>[];
}[];

/**
 * A document's sections inside another page (a consent form, settings,
 * the admin history), with headings at `level` so the page's outline
 * holds. No ids: the same document may show more than once on a page.
 */
export function LegalSectionsText({
  sections,
  level,
}: {
  sections: Sections;
  level: "h2" | "h3" | "h4";
}) {
  const Heading = level;
  return (
    <div className="prose-foa">
      {sections.map((s) => (
        <section key={s.id}>
          <Heading>{s.title}</Heading>
          {s.blocks.map((b, k) => (
            <div key={k} className="mt-3">
              <LegalBlockView block={b} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** A document's short version as a plain list. */
export function LegalShortList({
  points,
  id,
  className,
}: {
  points: ShownInline[][];
  id?: string;
  className?: string;
}) {
  return (
    <ul id={id} className={className}>
      {points.map((point, k) => (
        <li key={k}>
          <LegalInlines text={point} />
        </li>
      ))}
    </ul>
  );
}
