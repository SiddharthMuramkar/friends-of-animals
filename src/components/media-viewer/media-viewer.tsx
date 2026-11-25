"use client";

import {
  useId,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { ViewerCopy } from "./copy";
import { buttonStyles } from "@/components/site/button-link";
import type { BlindMedia } from "@/server/modules/judging/blind/domain/blind-entry-view";
import { clampPan, pinchZoom, zoomBy, type Point } from "./zoom";

const secondary = buttonStyles({ variant: "secondary" });
type ImageMedia = Extract<BlindMedia, { kind: "image" }>;
const initial = { zoom: 1, pan: { x: 0, y: 0 } };
const distance = (points: Point[]) =>
  points.length === 2
    ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
    : 0;

function ImageViewer({
  media,
  copy,
  onError,
}: {
  media: ImageMedia;
  copy: ViewerCopy;
  onError: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null);
  const title = useId(),
    help = useId();
  const [open, setOpen] = useState(false);
  const [transform, setTransform] = useState(initial);
  const state = useRef(initial);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ zoom: number; distance: number } | null>(null);
  function setView(zoom: number, pan = state.current.pan) {
    const bounds =
      image.current && stage.current
        ? clampPan(
            pan,
            zoom,
            {
              width: image.current.clientWidth,
              height: image.current.clientHeight,
            },
            {
              width: stage.current.clientWidth,
              height: stage.current.clientHeight,
            }
          )
        : { x: 0, y: 0 };
    state.current = { zoom, pan: bounds };
    setTransform(state.current);
  }
  function reset() {
    pointers.current.clear();
    pinch.current = null;
    state.current = initial;
    setTransform(initial);
  }
  function handleKey(event: KeyboardEvent<HTMLDialogElement>) {
    let handled = true;
    const { zoom, pan } = state.current;
    switch (event.key) {
      case "+":
      case "=":
        setView(zoomBy(zoom, 0.5));
        break;
      case "-":
        setView(zoomBy(zoom, -0.5));
        break;
      case "0":
        setView(1, { x: 0, y: 0 });
        break;
      case "ArrowLeft":
        setView(zoom, { ...pan, x: pan.x + 50 });
        break;
      case "ArrowRight":
        setView(zoom, { ...pan, x: pan.x - 50 });
        break;
      case "ArrowUp":
        setView(zoom, { ...pan, y: pan.y + 50 });
        break;
      case "ArrowDown":
        setView(zoom, { ...pan, y: pan.y - 50 });
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 2)
      pinch.current = {
        zoom: state.current.zoom,
        distance: distance([...pointers.current.values()]),
      };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size === 2) {
      setView(
        pinchZoom(
          pinch.current.zoom,
          pinch.current.distance,
          distance([...pointers.current.values()])
        )
      );
      return;
    }
    const { zoom, pan } = state.current;
    setView(zoom, {
      x: pan.x + point.x - previous.x,
      y: pan.y + point.y - previous.y,
    });
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
  }
  return (
    <div className="flex flex-col items-center gap-4">
      {/* oxlint-disable-next-line nextjs/no-img-element -- Already resized private signed derivative (or styleguide image). */}
      <img
        src={media.url}
        alt={copy.workAlt}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        onError={onError}
        className="max-h-[65dvh] w-auto max-w-full rounded-xl object-contain"
      />
      <button
        type="button"
        className={secondary}
        onClick={() => {
          reset();
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        {copy.fullScreen}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        aria-describedby={help}
        onKeyDown={handleKey}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-surface text-ink open:flex open:flex-col [&:modal]:overscroll-contain [&::backdrop]:bg-black/80 [&::backdrop]:overflow-hidden [&::backdrop]:overscroll-contain"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3 pt-[max(.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <h1 id={title} className="text-xl font-bold">
              {copy.viewTitle}
            </h1>
            <p id={help} className="text-sm text-ink-muted">
              {copy.zoomHelp}
            </p>
          </div>
          <form method="dialog">
            <button type="submit" className={secondary}>
              {copy.closeViewer}
            </button>
          </form>
        </header>
        <div
          ref={stage}
          className="flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-surface-muted select-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
        >
          {open ? (
            // oxlint-disable-next-line nextjs/no-img-element -- Signed derivative; transform is for client-side inspection only.
            <img
              ref={image}
              src={media.url}
              alt={copy.workAlt}
              draggable={false}
              onError={onError}
              className="max-h-full max-w-full object-contain"
              style={{
                transform: `translate(${transform.pan.x}px, ${transform.pan.y}px) scale(${transform.zoom})`,
              }}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-surface p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className={secondary}
            onClick={() => setView(zoomBy(state.current.zoom, -0.5))}
            disabled={transform.zoom <= 1}
          >
            {copy.zoomOut}
          </button>
          <button
            type="button"
            className={secondary}
            onClick={() => setView(1, { x: 0, y: 0 })}
          >
            {copy.fit}
          </button>
          <button
            type="button"
            className={secondary}
            onClick={() => setView(zoomBy(state.current.zoom, 0.5))}
            disabled={transform.zoom >= 4}
          >
            {copy.zoomIn}
          </button>
          <span className="font-semibold" aria-live="polite">
            {copy.zoomValue.replace(
              "{percent}",
              String(Math.round(transform.zoom * 100))
            )}
          </span>
        </div>
      </dialog>
    </div>
  );
}

/** The viewer receives only already-authorized media. It never fetches an
 * original or builds a storage URL. The caller may refresh its authorization. */
export function MediaViewer({
  media,
  copy,
  onRefresh,
}: {
  media: BlindMedia;
  copy: ViewerCopy;
  onRefresh?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const refresh = onRefresh ? (
    <button
      type="button"
      className={secondary}
      onClick={() => {
        setFailed(false);
        onRefresh();
      }}
    >
      {copy.refreshWork}
    </button>
  ) : null;
  return (
    <div className="flex flex-col gap-4">
      {media.kind === "image" ? (
        <ImageViewer
          media={media}
          copy={copy}
          onError={() => setFailed(true)}
        />
      ) : null}
      {media.kind === "video" ? (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- Submitted videos have no captions upload yet (#86); judges play the participant's own work.
        <video
          key={media.url}
          controls
          playsInline
          preload="metadata"
          poster={media.posterUrl ?? undefined}
          aria-label={copy.videoLabel}
          onError={() => setFailed(true)}
          className="max-h-[65dvh] w-full rounded-xl bg-black"
        >
          <source src={media.url} type="video/mp4" />
        </video>
      ) : null}
      {media.kind === "essay_text" ? (
        <div>
          <h3 className="font-bold">{copy.essay}</h3>
          <p className="mt-3 whitespace-pre-wrap wrap-break-word text-body leading-relaxed">
            {media.text}
          </p>
        </div>
      ) : null}
      {media.kind === "document" ? (
        <a
          className={secondary}
          href={media.url}
          target="_blank"
          rel="noreferrer"
        >
          {copy.pdf}
        </a>
      ) : null}
      {media.kind === "unavailable" ? <p>{copy.unavailable}</p> : null}
      {failed ? <output>{copy.mediaFailed}</output> : null}
      {refresh}
    </div>
  );
}
