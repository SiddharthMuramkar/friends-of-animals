import { ChevronDown } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Image from "next/image";

import { LivingIllustration } from "@/components/art/living-illustration";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import { type Art, art, siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

/** The illustrations section's heading, the target of the header's link. */
export const ART_CREDITS_ID = "credits-illustrations";

/** How many thumbnails a sheet's card shows before "+n". */
const THUMBS = 8;

/** A living illustration's thumbnail frame width: w-20. */
const LIVING_THUMB_PX = 80;

/** Folders whose drawings were cut from sheets, each with a group title. */
const SHEET_FOLDERS = ["stickers", "portraits", "waiting"] as const;
type SheetFolder = (typeof SHEET_FOLDERS)[number];
const isSheetFolder = (folder: string): folder is SheetFolder =>
  (SHEET_FOLDERS as readonly string[]).includes(folder);

const folderOf = (a: Art) => a.file.split("/")[0]!;

/**
 * A sheet folder gets one card, however many generations made it, so its
 * title heads the page once; any other drawing shares its generation's card.
 */
type Group = { key: string; items: Art[] };

function groups(): Group[] {
  const byKey = new Map<string, Art[]>();
  for (const a of art) {
    const folder = folderOf(a);
    const key = isSheetFolder(folder) ? folder : a.generationIds[0]!;
    byKey.set(key, [...(byKey.get(key) ?? []), a]);
  }
  return [...byKey.entries()].map(([key, items]) => ({ key, items }));
}

/** A fact's distinct values across a card's drawings, in registry order. */
const distinct = (values: readonly string[]) => [...new Set(values)];

const madeWith = (a: Art) =>
  `${a.tool} · ${a.model}${a.video ? ` · ${a.video}` : ""}`;

async function ArtCreditCard({ group }: { group: Group }) {
  const t = await getTranslations("credits.illustrations");
  const tf = await getTranslations("credits.fields");
  const format = await getFormatter();
  const [first] = group.items;
  if (!first) return null;
  const folder = folderOf(first);
  const sheet = group.items.length > 1 && isSheetFolder(folder);
  const title = sheet ? t(`sheets.${folder}`) : first.title;
  const means = group.items.map((a) => a.review.mean);
  const mean = means.reduce((sum, m) => sum + m, 0) / means.length;
  // The smallest panel among the card's drawings (every panel so far had 3).
  const judges = Math.min(...group.items.map((a) => a.review.judges));
  const score = (n: number) => format.number(n, { maximumFractionDigits: 1 });
  // Who has looked, from the registry: never claims a review that has not
  // happened, and stops saying "no person" once FOA records one.
  const reviewers = format.list(
    distinct(
      group.items.flatMap((a) =>
        a.review.humanReviewer ? [a.review.humanReviewer] : []
      )
    )
  );
  const unreviewed = group.items.filter((a) => !a.review.humanReviewer).length;
  const human =
    unreviewed === group.items.length
      ? t("notReviewed", { count: unreviewed })
      : unreviewed === 0
        ? t("reviewedBy", { names: reviewers })
        : t("reviewedSome", { names: reviewers, count: unreviewed });
  // A sheet folder's card can hold several generations, so each fact lists
  // every value among its drawings, not just the first drawing's.
  const tools = distinct(group.items.map(madeWith));
  const dates = format.list(
    distinct(group.items.map((a) => a.generatedAt))
      .sort()
      .map((day) => format.dateTime(new Date(day), { dateStyle: "medium" }))
  );
  const reasons = distinct(group.items.map((a) => a.whyChosen));
  return (
    <li className="@container/art-credit">
      <article className="flex h-full flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-4 @min-[32rem]/art-credit:p-5">
        <div className="flex flex-wrap items-end gap-2">
          {group.items.slice(0, THUMBS).map((a) =>
            a.kind === "living" ? (
              // Still, on its awake frame, and served at thumbnail size,
              // not as the full strip a scroll-woken one needs.
              <LivingIllustration
                key={a.id}
                id={a.id}
                still={LIVING_THUMB_PX}
                decorative
                className="w-20"
              />
            ) : (
              <Image
                key={a.id}
                // No blur placeholder: the blur-free file keeps it out of
                // the RSC payload.
                src={siteArt(a.id).plain}
                alt=""
                sizes={sheet ? "48px" : "128px"}
                className={cn(
                  "h-auto object-contain",
                  sheet ? "w-12" : "max-h-32 w-32 rounded-xl"
                )}
              />
            )
          )}
          {group.items.length > THUMBS ? (
            <span className="text-sm text-ink-muted">
              {t("more", { count: group.items.length - THUMBS })}
            </span>
          ) : null}
        </div>
        <h3 className="font-sans text-body leading-snug font-bold wrap-break-word text-ink">
          {title}
          {sheet ? (
            <span className="font-normal text-ink-muted">
              {" "}
              ({t("pieces", { count: group.items.length })})
            </span>
          ) : null}
        </h3>
        {/* One <dd> per distinct value; col-start-2 keeps a second one in
            the value column. */}
        <dl className="grid grid-cols-[fit-content(35%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm wrap-anywhere">
          <dt className="text-ink-muted">{t("madeWith")}</dt>
          {tools.map((tool) => (
            <dd key={tool} className="col-start-2 text-ink">
              {tool}
            </dd>
          ))}
          <dt className="text-ink-muted">{t("madeOn")}</dt>
          <dd className="text-ink">{dates}</dd>
          <dt className="text-ink-muted">{t("checked")}</dt>
          <dd className="text-ink">
            {sheet
              ? t("checkedSheet", {
                  judges,
                  mean: score(mean),
                  min: score(Math.min(...means)),
                })
              : t("checkedValue", { judges, mean: score(mean) })}{" "}
            {human}
          </dd>
          <dt className="text-ink-muted">{tf("why")}</dt>
          {reasons.map((reason) => (
            <dd key={reason} className="col-start-2 text-ink">
              {reason}
            </dd>
          ))}
        </dl>
        <details className="mt-auto rounded-2xl bg-surface-muted p-3 text-sm">
          {/* A flex summary loses the browser's marker: the chevron, as on
              Disclosure, shows it opens and turns when it is open. */}
          <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between gap-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">{t("asked")}</span>
            {/* Its own <details> only: group-open would match an open
                parent. */}
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-ink-muted transition-transform duration-200 [details[open]>summary>&]:rotate-180"
            />
          </summary>
          <p className="mt-2 text-ink-muted">{t("askedNote")}</p>
          {sheet ? (
            <ul className="mt-2 space-y-2 text-ink">
              {group.items.map((a) => (
                <li key={a.id}>
                  <strong className="block">{a.title}</strong>
                  {a.prompt}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-ink">{first.prompt}</p>
          )}
        </details>
      </article>
    </li>
  );
}

/**
 * The AI illustrations group on /credits: provenance, one card per sheet
 * folder or per generation.
 */
export async function ArtCredits() {
  const t = await getTranslations("credits.illustrations");
  const list = groups();
  return (
    <Section
      labelledBy={ART_CREDITS_ID}
      width="wide"
      className="py-12 sm:py-16"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2
          id={ART_CREDITS_ID}
          className="flex min-w-0 items-center gap-3 text-h3 text-ink"
        >
          <TileMarker hue="red" size="lg" />
          <span className="min-w-0 wrap-break-word">{t("title")}</span>
        </h2>
        <p className="text-ink-muted">{t("count", { count: art.length })}</p>
      </div>
      <p className="mt-3 max-w-prose text-ink-muted">{t("lead")}</p>
      <p className="mt-3 max-w-prose text-ink-muted">{t("rules")}</p>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {list.map((group) => (
          <ArtCreditCard key={group.key} group={group} />
        ))}
      </ul>
    </Section>
  );
}
