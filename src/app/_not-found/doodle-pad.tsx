"use client";

import { getStroke } from "perfect-freehand";
import { Download, Trash2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import {
  bitmapSize,
  moveCursor,
  outlineToPath,
  PAD,
  PAD_CENTRE,
  type Point,
  strokeOwner,
  toPad,
  toPercent,
} from "./doodle-math";

export type DoodleLabels = {
  canvas: string;
  draw: string;
  stamp: string;
  tool: string;
  colour: string;
  stampKind: string;
  keyboardHint: string;
  undo: string;
  clear: string;
  clearConfirm: string;
  clearYes: string;
  clearNo: string;
  download: string;
  placed: string;
  cleared: string;
  undone: string;
  colours: Record<ColourId, string>;
  stamps: Record<StampId, string>;
};

type ColourId = "ink" | "red" | "green" | "blue" | "yellow";
type StampId = "paw" | "heart" | "leaf";
/** x and y in pad units (doodle-math's PAD), then pressure. */
type Pt = [number, number, number];
type Op =
  | { kind: "stroke"; color: string; pen: boolean; pts: Pt[] }
  | { kind: "stamp"; stamp: StampId; x: number; y: number; color: string };

const COLOURS: [ColourId, string][] = [
  ["ink", "#25221E"],
  ["red", "#C92827"],
  ["green", "#07AC06"],
  ["blue", "#2B41F0"],
  ["yellow", "#E9A400"],
];
const STAMPS: StampId[] = ["paw", "heart", "leaf"];
// In pad units; a desktop-sized pad shows them at about 0.64×.
const STROKE_SIZE = 24;
const STAMP_SIZE = 80;
const PAPER = "#FFFFFF";
// Disabled-looking controls that stay focusable (aria-disabled, not
// disabled), so focus never drops to <body> when the drawing empties.
const ARIA_DISABLED =
  "aria-disabled:pointer-events-none aria-disabled:opacity-60";

function strokePath(op: Extract<Op, { kind: "stroke" }>): Path2D {
  const outline = getStroke(op.pts, {
    size: STROKE_SIZE,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !op.pen,
    last: true,
  });
  return new Path2D(outlineToPath(outline));
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  op: Extract<Op, { kind: "stamp" }>
) {
  const s = STAMP_SIZE / 2;
  ctx.save();
  ctx.translate(op.x, op.y);
  ctx.fillStyle = op.color;
  ctx.beginPath();
  if (op.stamp === "paw") {
    ctx.ellipse(0, s * 0.35, s * 0.55, s * 0.45, 0, 0, Math.PI * 2);
    for (const [dx, dy] of [
      [-0.62, -0.25],
      [-0.22, -0.62],
      [0.22, -0.62],
      [0.62, -0.25],
    ] as const) {
      ctx.moveTo(dx * s + s * 0.2, dy * s);
      ctx.arc(dx * s, dy * s, s * 0.2, 0, Math.PI * 2);
    }
  } else if (op.stamp === "heart") {
    ctx.moveTo(0, s * 0.8);
    ctx.bezierCurveTo(-s * 1.2, 0, -s * 0.6, -s * 0.9, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.6, -s * 0.9, s * 1.2, 0, 0, s * 0.8);
  } else {
    ctx.rotate(-Math.PI / 4);
    ctx.ellipse(0, 0, s * 0.45, s * 0.9, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (op.stamp === "leaf") {
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.lineTo(0, s * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOp(ctx: CanvasRenderingContext2D, op: Op) {
  if (op.kind === "stroke") {
    ctx.fillStyle = op.color;
    ctx.fill(strokePath(op));
  } else drawStamp(ctx, op);
}

/** Paper and every op, on a context already scaled to pad units. */
function render(ctx: CanvasRenderingContext2D, ops: Op[]) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAD.width, PAD.height);
  for (const op of ops) drawOp(ctx, op);
}

/** The canvas's content box (inside its border), in client px. */
function padBox(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect();
  return {
    left: r.left + c.clientLeft,
    top: r.top + c.clientTop,
    width: c.clientWidth,
    height: c.clientHeight,
  };
}

type PointerSample = {
  clientX: number;
  clientY: number;
  pressure: number;
  pointerType: string;
};

/**
 * The 404 doodle pad: vectors in memory, PNG on device. Ops are stored in
 * pad units and drawn scaled, so the drawing survives a resize or rotation.
 * Committed ops live on an offscreen layer, so a frame only copies that
 * layer and draws the live stroke, however big the drawing gets.
 */
export function DoodlePad({ labels }: { labels: DoodleLabels }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef(0);
  const ops = useRef<Op[]>([]);
  const live = useRef<Extract<Op, { kind: "stroke" }> | null>(null);
  const [stroke] = useState(strokeOwner);
  const [tool, setTool] = useState<"draw" | "stamp">("draw");
  const [colour, setColour] = useState<ColourId>("ink");
  const [stamp, setStamp] = useState<StampId>("paw");
  const [cursor, setCursor] = useState<Point | null>(null);
  const [count, setCount] = useState(0);
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const keepRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  const hex = COLOURS.find(([id]) => id === colour)![1];

  /** Redraws the committed ops onto the layer: on resize, undo and clear. */
  function rebuildLayer() {
    const c = canvasRef.current;
    if (!c) return;
    const layer = (layerRef.current ??= document.createElement("canvas"));
    layer.width = c.width;
    layer.height = c.height;
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(c.width / PAD.width, 0, 0, c.height / PAD.height, 0, 0);
    render(ctx, ops.current);
  }

  function paint() {
    frame.current = 0;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    const layer = layerRef.current;
    if (!c || !ctx || !layer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    if (live.current) {
      ctx.setTransform(c.width / PAD.width, 0, 0, c.height / PAD.height, 0, 0);
      drawOp(ctx, live.current);
    }
  }

  /** At most one paint per animation frame. */
  function schedulePaint() {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }

  /** Sizes the bitmap to the canvas's box on screen and redraws. */
  function resize() {
    const c = canvasRef.current;
    if (!c) return;
    const bitmap = bitmapSize(padBox(c), window.devicePixelRatio);
    if (
      c.width === bitmap.width &&
      c.height === bitmap.height &&
      layerRef.current
    )
      return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    rebuildLayer();
    paint();
  }

  // Measure before focusing, so the canvas has its size before the first
  // keyboard stamp. The launcher button is gone once the pad loads: move
  // focus to the pad.
  useLayoutEffect(() => {
    resize();
    surfaceRef.current?.focus();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(c);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  // Into the confirm step: focus "Keep it". Out of it, by either button
  // (both unmount): focus Clear, so focus never drops to <body>.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) clearRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  function commit(op: Op) {
    ops.current.push(op);
    const ctx = layerRef.current?.getContext("2d");
    if (ctx) drawOp(ctx, op);
    setCount(ops.current.length);
    schedulePaint();
  }

  function placeStamp(x: number, y: number) {
    commit({ kind: "stamp", stamp, x, y, color: hex });
    setStatus(labels.placed.replace("{stamp}", labels.stamps[stamp]));
  }

  function point(e: PointerSample, box: ReturnType<typeof padBox>): Pt {
    const { x, y } = toPad(e.clientX, e.clientY, box);
    return [x, y, e.pointerType === "pen" ? e.pressure : 0.5];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    if (tool === "stamp") {
      if (!e.isPrimary) return;
      const [x, y] = point(e.nativeEvent, padBox(c));
      setCursor({ x, y });
      placeStamp(x, y);
      return;
    }
    // Only the first finger draws; others are ignored until it lifts.
    if (!stroke.claim(e)) return;
    c.setPointerCapture(e.pointerId);
    live.current = {
      kind: "stroke",
      color: hex,
      pen: e.pointerType === "pen",
      pts: [point(e.nativeEvent, padBox(c))],
    };
    schedulePaint();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!live.current || !stroke.owns(e.pointerId)) return;
    const box = padBox(e.currentTarget);
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) live.current.pts.push(point(ev, box));
    schedulePaint();
  }

  /** Pointer up, cancel or lost capture: ends the stroke if it owns it. */
  function onPointerEnd(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!stroke.release(e.pointerId)) return;
    const op = live.current;
    live.current = null;
    if (op) commit(op);
  }

  function stampAtCursor() {
    const at = cursor ?? PAD_CENTRE;
    setCursor(at);
    placeStamp(at.x, at.y);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const next = moveCursor(cursor ?? PAD_CENTRE, e.key, e.shiftKey);
    if (next) {
      e.preventDefault();
      setCursor(next);
    }
  }

  // Undo, Clear and Download stay focusable when there is nothing to act
  // on (aria-disabled), so each handler checks for itself.
  function undo() {
    if (!ops.current.length) return;
    ops.current.pop();
    rebuildLayer();
    setCount(ops.current.length);
    setStatus(labels.undone);
    schedulePaint();
  }

  function clear() {
    ops.current = [];
    rebuildLayer();
    setCount(0);
    setConfirming(false);
    setStatus(labels.cleared);
    schedulePaint();
  }

  function download() {
    if (!ops.current.length) return;
    // The whole drawing at the pad's logical size, whatever the screen.
    const c = document.createElement("canvas");
    c.width = PAD.width;
    c.height = PAD.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    render(ctx, ops.current);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: "my-foa-doodle.png",
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      c.width = c.height = 0;
    }, "image/png");
  }

  const chip =
    "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-border-strong bg-surface px-4 font-semibold text-ink hover:border-ink has-checked:border-ink has-checked:bg-ink has-checked:text-surface has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-ink-muted">
            {labels.tool}
          </legend>
          <div className="mt-2 flex gap-2">
            {(["draw", "stamp"] as const).map((id) => (
              <label key={id} className={chip}>
                <input
                  type="radio"
                  name="doodle-tool"
                  className="sr-only"
                  checked={tool === id}
                  onChange={() => setTool(id)}
                />
                {labels[id]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold text-ink-muted">
            {labels.colour}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLOURS.map(([id, value]) => (
              <label key={id} className={chip}>
                <input
                  type="radio"
                  name="doodle-colour"
                  className="sr-only"
                  checked={colour === id}
                  onChange={() => setColour(id)}
                />
                <span
                  aria-hidden="true"
                  className="size-4 rounded-[22%] ring-2 ring-surface"
                  style={{ backgroundColor: value }}
                />
                {labels.colours[id]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold text-ink-muted">
            {labels.stampKind}
          </legend>
          <div className="mt-2 flex gap-2">
            {STAMPS.map((id) => (
              <label key={id} className={chip}>
                <input
                  type="radio"
                  name="doodle-stamp"
                  className="sr-only"
                  checked={stamp === id}
                  onChange={() => setStamp(id)}
                />
                {labels.stamps[id]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* At most as tall as the screen below the sticky header, so the
          whole pad fits on a landscape phone. */}
      <div className="relative mx-auto w-[min(100%,calc((100dvh-var(--header-height)-2rem)*4/3))]">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          className={cn(
            "block aspect-4/3 w-full touch-none rounded-3xl border-2 border-border-strong bg-white",
            tool === "stamp" ? "cursor-copy" : "cursor-crosshair"
          )}
        />
        {/* Keyboard surface: pointer events pass through to the canvas. */}
        <button
          ref={surfaceRef}
          type="button"
          aria-label={labels.canvas.replace("{count}", String(count))}
          aria-describedby="doodle-hint"
          onKeyDown={onKeyDown}
          onClick={stampAtCursor}
          onFocus={() => {
            setFocused(true);
            setCursor((c) => c ?? PAD_CENTRE);
          }}
          onBlur={() => setFocused(false)}
          className="pointer-events-none absolute inset-0 rounded-3xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        {focused && cursor ? (
          // Inside the canvas border, where pad units map to the bitmap.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0.5"
          >
            <span
              className="absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-ink"
              style={toPercent(cursor)}
            />
          </span>
        ) : null}
      </div>
      <p id="doodle-hint" className="text-sm text-ink-muted">
        {labels.keyboardHint}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={undo}
          aria-disabled={count === 0}
          className={cn(buttonStyles({ variant: "secondary" }), ARIA_DISABLED)}
        >
          <Undo2 aria-hidden="true" />
          {labels.undo}
        </button>
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">
              {labels.clearConfirm}
            </span>
            <button
              type="button"
              onClick={clear}
              className={buttonStyles({ variant: "secondary" })}
            >
              {labels.clearYes}
            </button>
            <button
              ref={keepRef}
              type="button"
              onClick={() => setConfirming(false)}
              className={buttonStyles({ variant: "secondary" })}
            >
              {labels.clearNo}
            </button>
          </span>
        ) : (
          <button
            ref={clearRef}
            type="button"
            onClick={() => {
              if (count > 0) setConfirming(true);
            }}
            aria-disabled={count === 0}
            className={cn(
              buttonStyles({ variant: "secondary" }),
              ARIA_DISABLED
            )}
          >
            <Trash2 aria-hidden="true" />
            {labels.clear}
          </button>
        )}
        <button
          type="button"
          onClick={download}
          aria-disabled={count === 0}
          className={cn(buttonStyles(), ARIA_DISABLED)}
        >
          <Download aria-hidden="true" />
          {labels.download}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
