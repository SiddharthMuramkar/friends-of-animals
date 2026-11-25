"use client";

import { Download, Share2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import { CARD, LOGO_TOP, cardLayout, cleanName } from "./pledge-text";

type Option = { id: string; label: string };

export type PledgeLabels = {
  name: string;
  nameHint: string;
  animal: string;
  promise: string;
  preview: string;
  download: string;
  share: string;
  preparing: string;
  exportFailed: string;
  privacy: string;
  cardTitle: string;
  /** Contains "{name}". */
  cardWithName: string;
  cardNoName: string;
  /** Contains "{animal}". */
  cardNeighbour: string;
  cardQuote: string;
  cardQuoteSource: string;
  shareTitle: string;
  shareText: string;
};

const { width: W, height: H, size: SIZE } = CARD;
const PAPER = "#FEFAF2";
const INK = "#25221E";
const MUTED = "#5C564D";
const BLUE = "#2B41F0";
const TEAL = "#006C75";
const TEAL_TINT = "#DDF3F5";
const TILES = ["#C92827", "#07AC06", "#2B41F0"];
const FILE_NAME = "foa-kindness-pledge.png";
const PNG = "image/png";
const TEXT_WIDTH = CARD.textWidth;

function fontVar(name: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || "sans-serif";
}

let logoPromise: Promise<HTMLImageElement> | null = null;
function loadLogo(): Promise<HTMLImageElement> {
  logoPromise ??= (async () => {
    const img = new Image();
    img.src = "/brand/foa-logo.svg";
    await img.decode();
    return img;
  })();
  return logoPromise;
}

type CardText = {
  title: string;
  lead: string;
  promise: string;
  neighbour: string;
  quote: string;
  source: string;
};

async function drawCard(
  c: HTMLCanvasElement,
  text: CardText,
  isCurrent: () => boolean
): Promise<boolean> {
  const display = fontVar("--font-baloo");
  const body = fontVar("--font-inter");
  // A face that fails to load must not stop the card: canvas falls back.
  await Promise.allSettled([
    document.fonts.load(`800 ${SIZE.promise}px ${display}`, text.promise),
    document.fonts.load(`500 ${SIZE.quote}px ${body}`, text.quote),
  ]);
  const logo = await loadLogo().catch(() => null);
  // The visitor may have edited the card while the fonts or logo loaded.
  // An earlier draw must never paint over the current preview.
  if (!isCurrent()) return false;
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return false;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "#E7DECF";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(48, 48, W - 96, H - 96, 64);
  ctx.fill();
  ctx.stroke();

  TILES.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(110 + i * 58, 120, 44, 44, 10);
    ctx.fill();
  });

  const { x } = CARD;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEAL;
  ctx.font = `700 60px ${display}`;
  ctx.fillText(text.title, x, 260);

  const leadFont = `700 ${SIZE.lead}px ${display}`;
  const promiseFont = `800 ${SIZE.promise}px ${display}`;
  const measureIn = (font: string) => (s: string) => {
    ctx.font = font;
    return ctx.measureText(s).width;
  };
  const layout = cardLayout(text, {
    lead: measureIn(leadFont),
    promise: measureIn(promiseFont),
  });

  ctx.fillStyle = INK;
  ctx.font = leadFont;
  for (const line of layout.lead) ctx.fillText(line.text, x, line.y);

  ctx.fillStyle = BLUE;
  ctx.font = promiseFont;
  for (const line of layout.promise) ctx.fillText(line.text, x, line.y);

  const pillH = CARD.pillHeight;
  ctx.font = `600 ${SIZE.pill}px ${body}`;
  const pillW = Math.min(
    TEXT_WIDTH,
    ctx.measureText(text.neighbour).width + 64
  );
  ctx.fillStyle = TEAL_TINT;
  ctx.beginPath();
  ctx.roundRect(x, layout.pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = TEAL;
  ctx.fillText(text.neighbour, x + 32, layout.pillY + 51, TEXT_WIDTH - 64);

  ctx.fillStyle = INK;
  ctx.font = `italic 500 ${SIZE.quote}px ${body}`;
  ctx.fillText(text.quote, x, layout.quoteY, TEXT_WIDTH);
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${SIZE.source}px ${body}`;
  ctx.fillText(text.source, x, layout.sourceY, TEXT_WIDTH);

  if (logo) {
    const { width, height, right } = CARD.logo;
    ctx.drawImage(logo, W - right - width, LOGO_TOP, width, height);
  }
  return true;
}

function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: file.name,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The kindness pledge card: a first name (optional), a street neighbour and a
 * promise, drawn on a canvas and saved as a PNG on the device. Nothing is sent
 * or stored.
 */
export function PledgeCard({
  animals,
  promises,
  labels,
}: {
  animals: Option[];
  promises: Option[];
  labels: PledgeLabels;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [animal, setAnimal] = useState(animals[0]!.id);
  const [promise, setPromise] = useState(promises[0]!.id);
  const [prepared, setPrepared] = useState<{
    card: CardText;
    file: File | null;
    canShare: boolean;
  } | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // On a slow phone the form works as plain HTML before hydration, and
  // hydration fires no change events: adopt what was typed and picked then,
  // or the card shows the defaults and the next render wipes the form.
  useEffect(() => {
    const fields = fieldsRef.current;
    if (!fields) return;
    const value = (selector: string) =>
      fields.querySelector<HTMLInputElement>(selector)?.value ?? "";
    const typed = value(`input[name="${uid}-name"]`);
    const pickedAnimal = value(`input[name="${uid}-animal"]:checked`);
    const pickedPromise = value(`input[name="${uid}-promise"]:checked`);
    if (typed) setName(typed);
    if (animals.some((a) => a.id === pickedAnimal)) setAnimal(pickedAnimal);
    if (promises.some((p) => p.id === pickedPromise)) setPromise(pickedPromise);
  }, [uid, animals, promises]);

  const clean = cleanName(name);
  const lead = clean
    ? labels.cardWithName.replace("{name}", clean)
    : labels.cardNoName;
  const promiseText = promises.find((p) => p.id === promise)!.label;
  const neighbour = labels.cardNeighbour.replace(
    "{animal}",
    animals.find((a) => a.id === animal)!.label
  );

  const summary = `${labels.cardTitle}. ${lead} ${promiseText}. ${neighbour}.`;
  const card = useMemo<CardText>(
    () => ({
      title: labels.cardTitle,
      lead,
      promise: `${promiseText}.`,
      neighbour,
      quote: labels.cardQuote,
      source: labels.cardQuoteSource,
    }),
    [
      labels.cardTitle,
      lead,
      promiseText,
      neighbour,
      labels.cardQuote,
      labels.cardQuoteSource,
    ]
  );
  // Tie the file to the text that produced it, not just the last completed
  // blob. The export becomes unavailable on the very render that edits it.
  const file = prepared?.card === card ? prepared.file : null;
  const failed = prepared?.card === card && !prepared.file;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let current = true;
    const fail = () => {
      if (current) setPrepared({ card, file: null, canShare: false });
    };
    void drawCard(c, card, () => current)
      .then((drawn) => {
        if (!current) return;
        if (!drawn) return fail();
        // Prepare the PNG now: an await before navigator.share() can cost the
        // tap's user activation on Safari.
        c.toBlob((blob) => {
          if (!current) return;
          if (!blob) return fail();
          const file = new File([blob], FILE_NAME, { type: PNG });
          let canShare = false;
          try {
            canShare = navigator.canShare?.({ files: [file] }) ?? false;
          } catch {
            // Download is still available if the share API is restricted.
          }
          setPrepared({ card, file, canShare });
        }, PNG);
      })
      .catch(fail);
    return () => {
      current = false;
    };
  }, [card]);

  async function share() {
    if (!file) return;
    try {
      await navigator.share({
        files: [file],
        title: labels.shareTitle,
        text: labels.shareText,
      });
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") saveFile(file);
    }
  }

  const chip =
    "inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-strong bg-surface px-4 font-semibold text-ink transition-colors hover:border-ink has-checked:border-teal-700 has-checked:bg-teal-700 has-checked:text-white has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
      {/* These fields are local-only, not a form that could send the name
          to the server when Enter is pressed before hydration. */}
      <div ref={fieldsRef} className="space-y-8">
        <div>
          <label
            htmlFor={`${uid}-name`}
            className="block font-semibold text-ink"
          >
            {labels.name}
          </label>
          <p id={`${uid}-hint`} className="mt-1 text-sm text-ink-muted">
            {labels.nameHint}
          </p>
          <input
            id={`${uid}-name`}
            name={`${uid}-name`}
            aria-describedby={`${uid}-hint ${uid}-privacy`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 block min-h-12 w-full max-w-sm rounded-2xl border-2 border-border-strong bg-surface px-4 text-lead text-ink focus-visible:border-ink"
          />
        </div>

        <fieldset className="min-w-0">
          <legend className="font-semibold text-ink">{labels.animal}</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {animals.map((a) => (
              <label key={a.id} className={chip}>
                <input
                  type="radio"
                  name={`${uid}-animal`}
                  value={a.id}
                  checked={animal === a.id}
                  onChange={() => setAnimal(a.id)}
                  className="sr-only"
                />
                {a.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="font-semibold text-ink">{labels.promise}</legend>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {promises.map((p) => (
              <label
                key={p.id}
                className={cn(chip, "rounded-2xl py-2 leading-snug")}
              >
                <input
                  type="radio"
                  name={`${uid}-promise`}
                  value={p.id}
                  checked={promise === p.id}
                  onChange={() => setPromise(p.id)}
                  className="sr-only"
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="font-semibold text-ink">{labels.preview}</p>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          aria-hidden="true"
          className="mt-3 block aspect-4/5 h-auto w-full rounded-3xl bg-[#FEFAF2] shadow-warm"
        />
        <p className="sr-only" aria-live="polite">
          {summary}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            aria-disabled={!file}
            onClick={() => file && saveFile(file)}
            className={cn(buttonStyles(), "flex-wrap aria-disabled:opacity-60")}
          >
            <Download aria-hidden="true" />
            {labels.download}
          </button>
          {prepared?.canShare ? (
            <button
              type="button"
              aria-disabled={!file}
              onClick={share}
              className={cn(
                buttonStyles({ variant: "secondary" }),
                "flex-wrap aria-disabled:opacity-60"
              )}
            >
              <Share2 aria-hidden="true" />
              {labels.share}
            </button>
          ) : null}
        </div>
        {failed ? (
          <output className="mt-3 block text-sm text-danger">
            {labels.exportFailed}
          </output>
        ) : !file ? (
          <p className="mt-3 text-sm text-ink-muted">{labels.preparing}</p>
        ) : null}
        <p id={`${uid}-privacy`} className="mt-3 text-sm text-ink-muted">
          {labels.privacy}
        </p>
      </div>
    </div>
  );
}
