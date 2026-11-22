import type {
  LegalBlock,
  LegalClause,
  LegalDoc,
  LegalFact,
  LegalInline,
  ShownInline,
} from "./model";

/** The facts a clause relies on: those written in it, and its `needs`. */
function clauseFacts({ clause, needs = [] }: LegalClause): LegalFact[] {
  const written = clause.flatMap((i) =>
    typeof i !== "string" && "fact" in i ? [i.fact] : []
  );
  return [...written, ...needs];
}

const isBlank = (text: ShownInline[]) =>
  text.every((i) => typeof i === "string" && i.trim() === "");

/**
 * A document as a deployment shows it. `shown(fact)` says whether a fact
 * renders: always outside production (as a tile until confirmed), and in
 * production only once confirmed. A clause renders when all its facts do,
 * else its `otherwise` words, or nothing; list items, blocks and sections
 * left empty are dropped, headings and all.
 */
export function resolveLegalDoc(
  doc: LegalDoc,
  shown: (fact: LegalFact) => boolean
): LegalDoc<ShownInline> {
  const inlines = (text: LegalInline[]): ShownInline[] =>
    text.flatMap((i): ShownInline[] => {
      if (typeof i === "string") return [i];
      if ("clause" in i) {
        return clauseFacts(i).every(shown)
          ? inlines(i.clause)
          : inlines(i.otherwise ?? []);
      }
      if ("fact" in i && !shown(i.fact)) return [];
      return [i];
    });
  const filled = (texts: LegalInline[][]) =>
    texts.map(inlines).filter((text) => !isBlank(text));
  const block = (b: LegalBlock): LegalBlock<ShownInline>[] => {
    if ("p" in b) {
      const p = inlines(b.p);
      return isBlank(p) ? [] : [{ p }];
    }
    const list = filled(b.list);
    return list.length > 0 ? [{ list }] : [];
  };

  return {
    updated: doc.updated,
    short: filled(doc.short),
    sections: doc.sections.flatMap((section) => {
      const blocks = section.blocks.flatMap(block);
      return blocks.length > 0 ? [{ ...section, blocks }] : [];
    }),
  };
}
