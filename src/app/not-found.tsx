import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { QuoteFigure } from "@/components/showcase/quote-figure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { ROUTES } from "@/lib/routes";

import { DoodleLauncher } from "./_not-found/doodle-launcher";
import type { DoodleLabels } from "./_not-found/doodle-pad";
import { PawTrail } from "./_not-found/paw-trail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("meta.title"), robots: { index: false } };
}

const WAYS_BACK: {
  href: string;
  key: "home" | "competitions" | "awareness";
  tile: TileHue;
}[] = [
  { href: ROUTES.home.path, key: "home", tile: "blue" },
  { href: ROUTES.competitions.path, key: "competitions", tile: "pink" },
  { href: ROUTES.awareness.path, key: "awareness", tile: "teal" },
];

/**
 * A 404 you can draw on. Unmatched URLs get a real 404. Next.js sends this
 * tree, and loads its client components, with every route, so keep it light:
 * no next/image (#45). The pad's own code loads only after the tap.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  const p = await getTranslations("notFound.pad");
  const labels: DoodleLabels = {
    canvas: p.raw("canvas") as string,
    draw: p("draw"),
    stamp: p("stamp"),
    tool: p("tool"),
    colour: p("colour"),
    stampKind: p("stampKind"),
    keyboardHint: p("keyboardHint"),
    undo: p("undo"),
    clear: p("clear"),
    clearConfirm: p("clearConfirm"),
    clearYes: p("clearYes"),
    clearNo: p("clearNo"),
    download: p("download"),
    placed: p.raw("placed") as string,
    cleared: p("cleared"),
    undone: p("undone"),
    colours: {
      ink: p("colours.ink"),
      red: p("colours.red"),
      green: p("colours.green"),
      blue: p("colours.blue"),
      yellow: p("colours.yellow"),
    },
    stamps: {
      paw: p("stamps.paw"),
      heart: p("stamps.heart"),
      leaf: p("stamps.leaf"),
    },
  };

  return (
    <>
      <Section hue="yellow" tone="tint" className="pt-10 sm:pt-14">
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-14">
          <div>
            <PageHeader
              eyebrow={t("eyebrow")}
              tile="yellow"
              title={t("title")}
              lead={t("body")}
            />
            <nav aria-labelledby="ways-back" className="mt-8">
              <h2 id="ways-back" className="sr-only">
                {t("waysBack")}
              </h2>
              <ul className="grid gap-3">
                {WAYS_BACK.map((w) => (
                  <li key={w.key}>
                    <Link
                      href={w.href}
                      className="group flex min-h-14 items-center gap-4 rounded-3xl border-2 border-border bg-surface px-5 py-3 shadow-warm transition-[translate,border-color] duration-200 hover:border-ink motion-safe:hover:-translate-y-0.5"
                    >
                      <TileMarker hue={w.tile} size="lg" />
                      <span className="flex-1">
                        <span className="block font-semibold text-ink">
                          {t(w.key)}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          {t(`${w.key}Hint`)}
                        </span>
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-5 text-ink-muted transition-transform duration-200 motion-safe:group-hover:translate-x-1"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <PawTrail className="mx-auto hidden md:block" />
        </div>
      </Section>

      <Section hue="yellow" labelledBy="draw-title">
        <SectionHeading
          id="draw-title"
          eyebrow={t("drawEyebrow")}
          tile="red"
          title={t("drawTitle")}
          lead={t("drawLead")}
        />
        <div className="mt-8 max-w-3xl">
          <DoodleLauncher
            start={t("start")}
            loading={t("loading")}
            labels={labels}
          />
        </div>
        <QuoteFigure id="Q26" size="md" hue="yellow" className="mt-14" />
      </Section>
    </>
  );
}
