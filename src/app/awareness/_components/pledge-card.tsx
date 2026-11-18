"use client";

import { Download, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import { cleanName, wrapWords } from "./pledge-text";

type Option = { id: string; label: string };

export type PledgeLabels = {
  name: string;
  nameHint: string;
  animal: string;
  promise: string;
  preview: string;
  download: string;
  share: string;
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

const W = 1080;
const H = 1350;
const PAPER = "#FEFAF2";
const INK = "#25221E";
const MUTED = "#5C564D";
const BLUE = "#2B41F0";
const TEAL = "#006C75";
const TEAL_TINT = "#DDF3F5";
const TILES = ["#C92827", "#07AC06", "#2B41F0"];
const FILE_NAME = "foa-kindness-pledge.png";
const PNG = "image/png";
const TEXT_WIDTH = 860;

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

async function drawCard(c: HTMLCanvasElement, text: CardText): Promise<void> {
  const display = fontVar("--font-baloo");
  const body = fontVar("--font-inter");
  // A face that fails to load must not stop the card: canvas falls back.
  await Promise.allSettled([
    document.fonts.load(`800 92px ${display}`, text.promise),
    document.fonts.load(`500 38px ${body}`, text.quote),
  ]);
  const logo = await loadLogo().catch(() => null);
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return;

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

  const x = 110;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEAL;
  ctx.font = `700 60px ${display}`;
  ctx.fillText(text.title, x, 260);

  let y = 380;
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${display}`;
  for (const line of wrapWords(
    text.lead,
    TEXT_WIDTH,
    (s) => ctx.measureText(s).width
  )) {
    ctx.fillText(line, x, y);
    y += 78;
  }

  y += 30;
  ctx.fillStyle = BLUE;
  ctx.font = `800 92px ${display}`;
  for (const line of wrapWords(
    text.promise,
    TEXT_WIDTH,
    (s) => ctx.measureText(s).width
  )) {
    ctx.fillText(line, x, y);
    y += 100;
  }

  y += 10;
  ctx.font = `600 38px ${body}`;
  const pillW = Math.min(
    TEXT_WIDTH,
    ctx.measureText(text.neighbour).width + 64
  );
  ctx.fillStyle = TEAL_TINT;
  ctx.beginPath();
  ctx.roundRect(x, y, pillW, 76, 38);
  ctx.fill();
  ctx.fillStyle = TEAL;
  ctx.fillText(text.neighbour, x + 32, y + 51, TEXT_WIDTH - 64);

  ctx.fillStyle = INK;
  ctx.font = `italic 500 38px ${body}`;
  ctx.fillText(text.quote, x, H - 400, TEXT_WIDTH);
  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${body}`;
  ctx.fillText(text.source, x, H - 354, TEXT_WIDTH);

  if (logo) {
    const lw = 280;
    ctx.drawImage(
      logo,
      W - 110 - lw,
      H - 110 - (lw * 169.62) / 294.23,
      lw,
      (lw * 169.62) / 294.23
    );
  }
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
 * or stored (tech-recipes §11).
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
  const [canShare, setCanShare] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<File | null>(null);

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

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let current = true;
    void drawCard(c, {
      title: labels.cardTitle,
      lead,
      promise: `${promiseText}.`,
      neighbour,
      quote: labels.cardQuote,
      source: labels.cardQuoteSource,
    })
      .then(() => {
        // Prepare the PNG now: an await before navigator.share() can cost the
        // tap's user activation on Safari.
        c.toBlob((blob) => {
          if (!current || !blob) return;
          const file = new File([blob], FILE_NAME, { type: PNG });
          fileRef.current = file;
          setCanShare(navigator.canShare?.({ files: [file] }) ?? false);
        }, PNG);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [lead, promiseText, neighbour, labels]);

  async function share() {
    const file = fileRef.current;
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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
      <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
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
            aria-describedby={`${uid}-hint ${uid}-privacy`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 block min-h-12 w-full max-w-sm rounded-2xl border-2 border-border-strong bg-surface px-4 text-lead text-ink focus-visible:border-ink"
          />
        </div>

        <fieldset>
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

        <fieldset>
          <legend className="font-semibold text-ink">{labels.promise}</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
      </form>

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
            onClick={() => fileRef.current && saveFile(fileRef.current)}
            className={buttonStyles()}
          >
            <Download aria-hidden="true" />
            {labels.download}
          </button>
          {canShare ? (
            <button
              type="button"
              onClick={share}
              className={buttonStyles({ variant: "secondary" })}
            >
              <Share2 aria-hidden="true" />
              {labels.share}
            </button>
          ) : null}
        </div>
        <p id={`${uid}-privacy`} className="mt-3 text-sm text-ink-muted">
          {labels.privacy}
        </p>
      </div>
    </div>
  );
}
