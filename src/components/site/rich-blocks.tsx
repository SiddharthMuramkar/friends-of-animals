import type { ReactNode } from "react";

import { ContactFact } from "@/components/site/contact-fact";
import { Placeholder } from "@/components/site/placeholder";
import { SiteLink } from "@/components/site/site-link";
import type { LegalBlock, LegalFact, LegalInline } from "@/content/legal";
import {
  legalFactValue,
  type OrgFacts,
} from "@/server/modules/cms/domain/org-facts";
import { linkRel } from "@/server/rich-text/href";

const LINK =
  "text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

/** A confirmed fact as text (or a mailto/tel link); else a visible placeholder. */
function Fact({ fact, facts }: { fact: LegalFact; facts: OrgFacts }) {
  const value = legalFactValue(facts, fact);
  if (fact === "phone") return <ContactFact kind="phone" fact={value} />;
  if (fact.toLowerCase().includes("email"))
    return <ContactFact kind="email" fact={value} />;
  return <Placeholder fact={value} />;
}

function Inlines({ text, facts }: { text: LegalInline[]; facts: OrgFacts }) {
  return text.map((piece, k): ReactNode => {
    if (typeof piece === "string") return piece;
    if ("strong" in piece) return <strong key={k}>{piece.strong}</strong>;
    if ("fact" in piece)
      return <Fact key={k} fact={piece.fact} facts={facts} />;
    return (
      <SiteLink
        key={k}
        href={piece.href}
        rel={linkRel(piece.href)}
        className={LINK}
      >
        {piece.link}
      </SiteLink>
    );
  });
}

/**
 * Sanitised rich text (paragraphs and lists) as React elements: text nodes
 * and the elements chosen here, never HTML from the content.
 */
export function RichBlocks({
  blocks,
  facts,
}: {
  blocks: readonly LegalBlock[];
  facts: OrgFacts;
}) {
  return blocks.map((block, k) =>
    "p" in block ? (
      <p key={k}>
        <Inlines text={block.p} facts={facts} />
      </p>
    ) : (
      <ul key={k} className="list-disc pl-6">
        {block.list.map((item, i) => (
          <li key={i}>
            <Inlines text={item} facts={facts} />
          </li>
        ))}
      </ul>
    )
  );
}
