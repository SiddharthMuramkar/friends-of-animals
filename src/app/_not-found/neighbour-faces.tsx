import { type SiteArtId, siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

/** The neighbours a visitor might have been hoping to find, left to right. */
const FACES = [
  "portrait-indie-dog",
  "portrait-street-cat",
  "portrait-cow",
  "portrait-rock-pigeon",
  "portrait-house-sparrow",
] as const satisfies readonly SiteArtId[];

/**
 * A row of neighbour faces to draw from, beside the doodle pad. Next.js sends
 * the 404 tree with every route (#45), so the faces are inline CSS
 * backgrounds: not next/image, and not a CSS module, which every page would
 * preload as a stylesheet it never applies. Each picture downloads only when
 * this page renders; every other page's RSC payload carries just these five
 * list items. Decorative: the footer's note says the drawings are AI
 * illustrations.
 *
 * One row: five 44px faces and four gaps are 268px, which fits from 320px.
 * A still tilt, alternating; the faces aren't controls, so nothing moves.
 */
export function NeighbourFaces({ className }: { className?: string }) {
  return (
    <ul aria-hidden="true" className={cn("flex flex-nowrap gap-3", className)}>
      {FACES.map((id) => (
        <li
          key={id}
          className="aspect-square w-11 bg-contain bg-bottom bg-no-repeat odd:-rotate-3 even:rotate-3 sm:w-13"
          style={{ backgroundImage: `url("${siteArt(id).plain.src}")` }}
        />
      ))}
    </ul>
  );
}
