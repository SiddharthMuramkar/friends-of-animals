"use client";

import { getStroke } from "perfect-freehand";
import { Download, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

import { moveCursor, outlineToPath, type Point } from "./doodle-math";

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
const MAX_DPR = 2;
const MAX_PIXELS = 2_500_000;
const STAMP_SIZE = 44;
const PAPER = "#FFFFFF";

function strokePath(op: Extract<Op, { kind: "stroke" }>): Path2D {
  const outline = getStroke(op.pts, {
    size: 12,
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
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.lineTo(0, s * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function render(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  w: number,
  h: number
) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  for (const op of ops) {
    if (op.kind === "stroke") {
      ctx.fillStyle = op.color;
      ctx.fill(strokePath(op));
    } else drawStamp(ctx, op);
  }
}

/** The 404 doodle pad: vectors in memory, PNG on device. */
export function DoodlePad({ labels }: { labels: DoodleLabels }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ops = useRef<Op[]>([]);
  const live = useRef<Extract<Op, { kind: "stroke" }> | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const [tool, setTool] = useState<"draw" | "stamp">("draw");
  const [colour, setColour] = useState<ColourId>("ink");
  const [stamp, setStamp] = useState<StampId>("paw");
  const [cursor, setCursor] = useState<Point | null>(null);
  const [count, setCount] = useState(0);
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const keepRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLButtonElement>(null);

  // The launcher button is gone once the pad loads: move focus to the pad.
  useEffect(() => {
    surfaceRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);
  const hex = COLOURS.find(([id]) => id === colour)![1];

  function paint() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const { width, height } = size.current;
    render(
      ctx,
      live.current ? [...ops.current, live.current] : ops.current,
      width,
      height
    );
  }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (width * height * dpr * dpr > MAX_PIXELS)
        dpr = Math.sqrt(MAX_PIXELS / (width * height));
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      size.current = { width, height };
      c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  function commit(op: Op) {
    ops.current.push(op);
    setCount(ops.current.length);
    paint();
  }

  function placeStamp(x: number, y: number) {
    commit({ kind: "stamp", stamp, x, y, color: hex });
    setStatus(labels.placed.replace("{stamp}", labels.stamps[stamp]));
  }

  function point(
    e: {
      clientX: number;
      clientY: number;
      pressure: number;
      pointerType: string;
    },
    c: HTMLCanvasElement
  ): Pt {
    const r = c.getBoundingClientRect();
    return [
      e.clientX - r.left,
      e.clientY - r.top,
      e.pointerType === "pen" ? e.pressure : 0.5,
    ];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!e.isPrimary) return;
    const c = e.currentTarget;
    const [x, y] = point(e.nativeEvent, c);
    if (tool === "stamp") {
      setCursor({ x, y });
      placeStamp(x, y);
      return;
    }
    c.setPointerCapture(e.pointerId);
    live.current = {
      kind: "stroke",
      color: hex,
      pen: e.pointerType === "pen",
      pts: [point(e.nativeEvent, c)],
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!live.current) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) live.current.pts.push(point(ev, e.currentTarget));
    requestAnimationFrame(paint);
  }

  function onPointerUp() {
    if (!live.current) return;
    const op = live.current;
    live.current = null;
    commit(op);
  }

  function centre(): Point {
    return { x: size.current.width / 2, y: size.current.height / 2 };
  }

  function stampAtCursor() {
    const at = cursor ?? centre();
    setCursor(at);
    placeStamp(at.x, at.y);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const next = moveCursor(
      cursor ?? centre(),
      e.key,
      e.shiftKey,
      size.current
    );
    if (next) {
      e.preventDefault();
      setCursor(next);
    }
  }

  function undo() {
    if (!ops.current.length) return;
    ops.current.pop();
    setCount(ops.current.length);
    setStatus(labels.undone);
    paint();
  }

  function clear() {
    ops.current = [];
    setCount(0);
    setConfirming(false);
    setStatus(labels.cleared);
    paint();
  }

  function download() {
    const { width, height } = size.current;
    const c = document.createElement("canvas");
    c.width = width * 2;
    c.height = height * 2;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);
    render(ctx, ops.current, width, height);
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

      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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
            setCursor((c) => c ?? centre());
          }}
          onBlur={() => setFocused(false)}
          className="pointer-events-none absolute inset-0 rounded-3xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        {focused && cursor ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-ink"
            style={{ left: cursor.x, top: cursor.y }}
          />
        ) : null}
      </div>
      <p id="doodle-hint" className="text-sm text-ink-muted">
        {labels.keyboardHint}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={undo}
          disabled={count === 0}
          className={buttonStyles({ variant: "secondary" })}
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
            type="button"
            onClick={() => setConfirming(true)}
            disabled={count === 0}
            className={buttonStyles({ variant: "secondary" })}
          >
            <Trash2 aria-hidden="true" />
            {labels.clear}
          </button>
        )}
        <button
          type="button"
          onClick={download}
          disabled={count === 0}
          className={buttonStyles()}
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
