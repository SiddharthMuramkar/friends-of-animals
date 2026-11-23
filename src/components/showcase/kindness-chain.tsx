import { getTranslations } from "next-intl/server";

import { Illustration } from "@/components/art/illustration";
import { KolamDivider } from "@/components/art/kolam-divider";
import type { SiteArtId } from "@/lib/art";
import { cn } from "@/lib/utils";

/** The three links, in order, each with its drawing. */
const STEPS = [
  { key: "create", art: "chain-create" },
  { key: "wall", art: "chain-wall" },
  { key: "street", art: "chain-street" },
] as const satisfies readonly { key: string; art: SiteArtId }[];

// How wide each drawing renders, by the Section width around the chain: a
// column of three from md (gap-x-20 between), and 144px (w-36), beside its
// caption, below md.
const SIZES = {
  wide: "(min-width: 1024px) 320px, (min-width: 768px) 25vw, 144px",
  prose: "(min-width: 768px) 187px, 144px",
} as const;

/**
 * From a child's drawing to a kinder street, in three AI illustrations: a
 * sketchbook by the window, pictures pinned up at school, a kinder street
 * corner, each with a hand-lettered caption. From md they stand in a row,
 * a kolam line joining each to the next; on phones each sits small beside
 * its caption, a short kolam joining it to the one below. Each drawing keeps
 * its alt text, with its AI mark underneath rather than over a corner.
 * Shown on /about and /donate.
 */
export async function KindnessChain({
  container = "wide",
  className,
}: {
  /** The width of the Section around it, for the images' `sizes`. */
  container?: keyof typeof SIZES;
  className?: string;
}) {
  const t = await getTranslations("about.how.chain");
  return (
    <ol
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops the list role once list-style is none (WebKit bug 170179), and the steps' order matters
      role="list"
      className={cn(
        "grid grid-cols-1 md:grid-cols-3 md:items-start md:gap-x-20",
        className
      )}
    >
      {STEPS.map(({ key, art }, i) => {
        const joined = i < STEPS.length - 1;
        return (
          <li key={key} className="@container">
            {/* Below md the caption wraps under its drawing when enlarged
                text leaves it no room beside it: in a step narrower than
                17rem (the drawing, the gap and the caption's basis). */}
            <figure className="flex flex-wrap items-center gap-4 md:block">
              <div className="relative w-36 max-w-full shrink-0 md:w-auto">
                <Illustration
                  id={art}
                  sizes={SIZES[container]}
                  mark="below"
                  pop
                  className="mx-auto w-full max-w-xs"
                />
                {/* Level with the drawing's middle: the mark below it is
                    1.875rem tall (mt-1 and a 26px tag). */}
                {joined ? (
                  <KolamDivider
                    dots={2}
                    className="absolute top-[calc(50%-0.9375rem)] left-full hidden w-20 -translate-y-1/2 md:flex"
                  />
                ) : null}
              </div>
              <figcaption className="min-w-0 flex-1 basis-28 text-start font-hand text-lead leading-snug text-balance text-ink md:mt-4 md:text-center">
                {t(key)}
              </figcaption>
            </figure>
            {/* Down the drawings' left side, clear of the mark (which
                starts ~45px in from their left edge): centred in the 62px
                from one drawing to the next, the mark's row (1.875rem) and
                this gap (2rem). Not once the caption wraps under the
                drawing: it would cross the caption. */}
            {joined ? (
              <div className="relative h-8 md:hidden">
                <KolamDivider
                  dots={2}
                  className="absolute top-px left-5.5 w-16 -translate-1/2 rotate-90 @max-[17rem]:hidden"
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
