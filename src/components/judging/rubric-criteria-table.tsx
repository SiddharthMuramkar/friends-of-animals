import { TableScroller } from "@/components/site/table-scroller";

export type RubricCriteriaRow = {
  label: string;
  description: string;
  /** Already formatted, e.g. "40%". */
  weight: string;
  /** Already formatted, e.g. "0 to 10". */
  scores: string;
};

/**
 * A rubric's criteria as a table: what judges look for, its share of the
 * score and its score range. Used by the admin rubric pages and the
 * coordinators' judging guide. Labels come in already translated.
 */
export function RubricCriteriaTable({
  id,
  caption,
  headings,
  rows,
}: {
  /** Unique on the page; the caption's id is built from it. */
  id: string;
  caption: string;
  headings: {
    label: string;
    description: string;
    weight: string;
    scores: string;
  };
  rows: RubricCriteriaRow[];
}) {
  const captionId = `${id}-caption`;
  return (
    <TableScroller captionId={captionId}>
      <table className="w-full min-w-xl border-collapse text-left">
        <caption id={captionId} className="sr-only">
          {caption}
        </caption>
        <thead>
          <tr className="border-b-2 border-border">
            <th scope="col" className="px-4 py-3 font-semibold text-ink">
              {headings.label}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-ink">
              {headings.description}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-semibold text-ink"
            >
              {headings.weight}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-semibold text-ink"
            >
              {headings.scores}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-b border-border last:border-b-0"
            >
              <th
                scope="row"
                className="px-4 py-3 align-top font-semibold text-ink"
              >
                {row.label}
              </th>
              <td className="px-4 py-3 align-top text-ink-muted">
                {row.description}
              </td>
              <td className="px-4 py-3 text-right align-top text-ink tabular-nums">
                {row.weight}
              </td>
              <td className="px-4 py-3 text-right align-top text-ink tabular-nums whitespace-nowrap">
                {row.scores}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
