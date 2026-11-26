import type { ConsentDocumentBody } from "./document-body";
import {
  creatorSharePercentForInput,
  parseCreatorSharePercent,
} from "../../auctions/domain/proceeds";

const SECTION = "auction-proceeds";
const START = "The creator receives ";
const END =
  "% of the auction proceeds; Friends of Animals receives the remainder.";

export const hasExplicitAuctionShare = (body: ConsentDocumentBody) =>
  body.sections.some((section) => section.id === SECTION);

/** The versioned text is the economics, not a mutable setting or an
 * unacknowledged side field. Existing documents absent the reserved
 * section represent the original 100%-to-FOA default only. */
export function auctionShareInDocument(
  body: ConsentDocumentBody
): number | null {
  const section = body.sections.find((s) => s.id === SECTION);
  if (!section) return 0;
  const block = section.blocks[0];
  const text =
    block && "p" in block && block.p.length === 1 ? block.p[0] : null;
  if (
    section.blocks.length !== 1 ||
    typeof text !== "string" ||
    !text.startsWith(START) ||
    !text.endsWith(END)
  )
    return null;
  const parsed = parseCreatorSharePercent(
    text.slice(START.length, -END.length)
  );
  return parsed.ok ? parsed.bps : null;
}

export function withAuctionShare(
  body: ConsentDocumentBody,
  bps: number
): ConsentDocumentBody {
  return {
    ...body,
    sections: [
      ...body.sections.filter((section) => section.id !== SECTION),
      {
        id: SECTION,
        title: "Auction proceeds",
        blocks: [{ p: [`${START}${creatorSharePercentForInput(bps)}${END}`] }],
      },
    ],
  };
}

/** On every new auction publication, the default is made explicit. An
 * incorrectly formed economics section is refused, not silently changed. */
export function explicitAuctionShare(
  body: ConsentDocumentBody
): ConsentDocumentBody | null {
  const bps = auctionShareInDocument(body);
  return bps === null ? null : withAuctionShare(body, bps);
}
