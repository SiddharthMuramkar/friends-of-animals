import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";

import { QuoteFigure } from "@/components/showcase/quote-figure";
import { Photo } from "@/components/site/photo";
import { TileMarker } from "@/components/site/tile";
import type { QuoteId } from "@/content/quotes";
import type { ArticleBody, Block, Footnote, Inline } from "@/content/stories";
import { WHAT_YOU_CAN_DO_TITLE, headingAnchors } from "@/content/stories/text";
import { cn } from "@/lib/utils";

import styles from "./article.module.css";

const OPEN_QUOTE = "“";
const CLOSE_QUOTE = "”";

type Labels = {
  sourceN: (n: number) => string;
  openSource: string;
  close: string;
};

/** The id of a source's entry in the numbered list. */
const sourceId = (n: number) => `source-${n}`;

type Ctx = {
  notes: Map<string, { n: number; note: Footnote }>;
  labels: Labels;
};

const REF =
  "inline-grid h-6 min-w-6 place-items-center rounded-full bg-yellow-100 px-1 align-baseline font-sans text-xs leading-none font-bold text-yellow-900 hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-100 dark:hover:bg-yellow-800";

/**
 * A superscript number that opens its source in place (popover). Where the
 * Popover API is missing (iOS 16), CSS swaps the button for a plain link to
 * the source's entry in the list below, and hides the note.
 */
function FootnoteRef({
  id,
  uid,
  ctx,
}: {
  id: string;
  /** Unique per reference: each one gets its own popover and anchor. */
  uid: string;
  ctx: Ctx;
}) {
  const { n, note } = ctx.notes.get(id)!;
  const popId = `note-${uid}`;
  const anchor = { "--anchor": `--note-${uid}` } as CSSProperties;
  return (
    <>
      <sup data-noread="" className="ms-0.5">
        <button
          type="button"
          popoverTarget={popId}
          aria-label={ctx.labels.sourceN(n)}
          style={anchor}
          className={cn(styles.ref, REF)}
        >
          {n}
        </button>
        <a
          href={`#${sourceId(n)}`}
          aria-label={ctx.labels.sourceN(n)}
          className={cn(styles.refLink, REF, "no-underline")}
        >
          {n}
        </a>
      </sup>
      <span
        id={popId}
        popover="auto"
        data-noread=""
        style={anchor}
        className={cn(
          styles.note,
          "w-[min(22rem,calc(100vw-2rem))] rounded-2xl border-2 border-border-strong bg-surface p-4 text-base text-ink shadow-warm open:block"
        )}
      >
        <span className="block text-sm font-semibold text-ink-muted">
          {ctx.labels.sourceN(n)}
        </span>
        <span className="mt-1 block">{note.text}</span>
        <span className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={note.url}
            rel="noreferrer"
            className="inline-flex min-h-6 items-center gap-1.5 font-semibold text-link underline underline-offset-2 hover:text-link-hover pointer-coarse:min-h-11"
          >
            {ctx.labels.openSource}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
          <button
            type="button"
            popoverTarget={popId}
            popoverTargetAction="hide"
            className="ms-auto inline-flex min-h-8 items-center rounded-full border-2 border-border px-3 text-sm font-semibold hover:bg-surface-muted pointer-coarse:min-h-11"
          >
            {ctx.labels.close}
          </button>
        </span>
      </span>
    </>
  );
}

function Inlines({
  text,
  ctx,
  path,
}: {
  text: Inline[];
  ctx: Ctx;
  /** Position of this run in the article, for unique footnote ids. */
  path: string;
}) {
  return text.map((i, k): ReactNode => {
    if (typeof i === "string") return i;
    if ("em" in i) return <em key={k}>{i.em}</em>;
    if ("strong" in i) return <strong key={k}>{i.strong}</strong>;
    if ("link" in i)
      return (
        <a key={k} href={i.href}>
          {i.link}
        </a>
      );
    return <FootnoteRef key={k} id={i.fn} uid={`${path}-${k}`} ctx={ctx} />;
  });
}

function Box({
  block,
  ctx,
  path,
}: {
  block: Extract<Block, { type: "callout" }>;
  ctx: Ctx;
  path: string;
}) {
  const actions = block.title === WHAT_YOU_CAN_DO_TITLE;
  return (
    <aside
      className={cn(
        "rounded-3xl border-2 p-5 sm:p-7",
        actions
          ? "border-green-700 bg-success-bg dark:border-green-400"
          : "border-border-strong bg-surface-muted"
      )}
    >
      {block.title ? (
        <h2 className="m-0! flex items-center gap-2.5 font-display text-h4! leading-tight">
          <TileMarker hue={actions ? "green" : "yellow"} />
          {block.title}
        </h2>
      ) : null}
      {actions ? (
        <ol className="mt-4 list-none! space-y-3 ps-0!">
          {block.body.map((text, k) => (
            <li key={k} className="flex gap-3">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-[22%] bg-green-500 font-display font-bold text-neutral-900"
              >
                {k + 1}
              </span>
              <span className="min-w-0 pt-0.5">
                <Inlines text={text} ctx={ctx} path={`${path}-${k}`} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-3 space-y-3">
          {block.body.map((text, k) => (
            <p key={k}>
              <Inlines text={text} ctx={ctx} path={`${path}-${k}`} />
            </p>
          ))}
        </div>
      )}
    </aside>
  );
}

function BlockView({
  block,
  anchor,
  ctx,
  path,
}: {
  block: Block;
  anchor?: string;
  ctx: Ctx;
  path: string;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <Inlines text={block.text} ctx={ctx} path={path} />
        </p>
      );
    case "heading": {
      const H = block.level === 2 ? "h2" : "h3";
      return (
        <H id={anchor} className="text-(--section-heading,var(--ink))">
          {block.text}
        </H>
      );
    }
    case "list": {
      const L = block.style === "number" ? "ol" : "ul";
      return (
        <L>
          {block.items.map((text, k) => (
            <li key={k}>
              <Inlines text={text} ctx={ctx} path={`${path}-${k}`} />
            </li>
          ))}
        </L>
      );
    }
    case "quote":
      return (
        <div className="my-10! [&_blockquote]:border-0 [&_blockquote]:ps-0">
          <QuoteFigure id={block.quoteId as QuoteId} hue="yellow" size="md" />
        </div>
      );
    case "sourceQuote":
      return (
        <figure className="my-8! border-s-4 border-yellow-500 ps-5">
          <blockquote className="border-0! ps-0!">
            <p className="font-display text-h4 leading-snug font-semibold">
              {OPEN_QUOTE}
              {block.text}
              {CLOSE_QUOTE}
            </p>
          </blockquote>
          <figcaption className="mt-2 text-sm text-ink-muted">
            {block.attribution}
            <FootnoteRef id={block.fn} uid={`${path}-q`} ctx={ctx} />
          </figcaption>
        </figure>
      );
    case "image":
      return (
        <Photo
          id={block.imageId}
          caption={block.caption}
          sizes="(min-width: 768px) 680px, 92vw"
        />
      );
    case "callout":
      return <Box block={block} ctx={ctx} path={path} />;
  }
}

/** The article's blocks, with footnotes that open in place. */
export async function ArticleBodyView({
  body,
  id,
}: {
  body: ArticleBody;
  id: string;
}) {
  const t = await getTranslations("stories.article");
  const notes = new Map(
    body.footnotes.map((note, i) => [note.id, { n: i + 1, note }])
  );
  const ctx: Ctx = {
    notes,
    labels: {
      sourceN: (n) => t("sourceN", { n }),
      openSource: t("openSource"),
      close: t("close"),
    },
  };
  const anchors = headingAnchors(body.blocks);
  return (
    <div id={id} className="prose-foa">
      {body.blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          anchor={anchors[i]}
          ctx={ctx}
          path={String(i)}
        />
      ))}
    </div>
  );
}

/** The numbered source list that every footnote points to. */
export async function SourceList({ footnotes }: { footnotes: Footnote[] }) {
  const t = await getTranslations("stories.article");
  return (
    <section aria-labelledby="sources" className="mt-14">
      <h2 id="sources" className="text-h3">
        {t("sources")}
      </h2>
      <p className="mt-3 max-w-prose text-ink-muted">{t("sourcesIntro")}</p>
      <ol className="mt-6 space-y-3">
        {footnotes.map((f, i) => (
          <li key={f.id} id={sourceId(i + 1)} className="flex gap-3">
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-[22%] bg-yellow-100 text-sm font-bold text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100"
            >
              {i + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="sr-only">{t("sourceN", { n: i + 1 })}: </span>
              <a
                href={f.url}
                rel="noreferrer"
                className="break-words text-link underline underline-offset-2 hover:text-link-hover"
              >
                {f.text}
              </a>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
