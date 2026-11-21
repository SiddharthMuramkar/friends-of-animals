import type { ReactNode } from "react";

import type { LegalFact, ShownInline } from "@/content/legal";
import type { ConsentDocumentBody } from "@/server/consent";

// A consent document body drawn in the browser, for the publish form's
// preview: the same blocks as src/components/legal/legal-text.tsx, which
// is server-only. Facts show as their names, since their values and
// "to be confirmed" words come from the server.

const LINK =
  "text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

function Inlines({
  text,
  factLabels,
}: {
  text: ShownInline[];
  factLabels: Record<LegalFact, string>;
}) {
  return text.map((i, k): ReactNode => {
    if (typeof i === "string") return i;
    if ("strong" in i) return <strong key={k}>{i.strong}</strong>;
    if ("fact" in i) return <code key={k}>{factLabels[i.fact]}</code>;
    return (
      <a key={k} href={i.href} className={LINK}>
        {i.link}
      </a>
    );
  });
}

export function BodyPreview({
  body,
  factLabels,
}: {
  body: ConsentDocumentBody;
  factLabels: Record<LegalFact, string>;
}) {
  return (
    <div className="prose-foa">
      {body.short.length > 0 ? (
        <ul>
          {body.short.map((point, k) => (
            <li key={k}>
              <Inlines text={point} factLabels={factLabels} />
            </li>
          ))}
        </ul>
      ) : null}
      {body.sections.map((section) => (
        <section key={section.id}>
          <h4>{section.title}</h4>
          {section.blocks.map((block, k) => (
            <div key={k} className="mt-3">
              {"p" in block ? (
                <p>
                  <Inlines text={block.p} factLabels={factLabels} />
                </p>
              ) : (
                <ul>
                  {block.list.map((item, j) => (
                    <li key={j}>
                      <Inlines text={item} factLabels={factLabels} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
