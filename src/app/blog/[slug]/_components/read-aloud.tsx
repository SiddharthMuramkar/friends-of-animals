"use client";

import { Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Labels = {
  listen: string;
  pause: string;
  resume: string;
  stop: string;
  onlineVoice: string;
  group: string;
};
type Status = "idle" | "speaking" | "paused";

const noop = () => () => {};
const supported = () =>
  "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Device voices first; en-IN, then other English voices. */
function pickVoice(voices: SpeechSynthesisVoice[]) {
  const lang = (v: SpeechSynthesisVoice) =>
    v.lang.replace("_", "-").toLowerCase();
  const order = ["en-in", "en-gb", "en-au", "en-us"];
  const best = (list: SpeechSynthesisVoice[]) =>
    order.map((l) => list.find((v) => lang(v) === l)).find(Boolean) ??
    list.find((v) => lang(v).startsWith("en"));
  return best(voices.filter((v) => v.localService)) ?? best(voices);
}

/** Sentence-sized chunks: Chrome stops long utterances after ~15 s. */
function toChunks(text: string, locale: string, max = 220): string[] {
  const out: string[] = [];
  let buf = "";
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  for (const { segment } of segmenter.segment(text)) {
    if (buf && (buf + segment).length > max) {
      out.push(buf.trim());
      buf = "";
    }
    buf += segment;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** The readable text of an article: blocks in order, minus footnote marks. */
function readableText(rootId: string): string {
  const root = document.getElementById(rootId);
  if (!root) return "";
  return [...root.querySelectorAll("h2, h3, p, li")]
    .filter((el) => !el.closest("[data-noread]"))
    .map((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      for (const n of copy.querySelectorAll("[data-noread]")) n.remove();
      const text = copy.textContent?.trim() ?? "";
      return /[.!?:”"]$/.test(text) ? text : `${text}.`;
    })
    .join("\n");
}

const BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-semibold transition-colors duration-150 [&_svg]:size-4";

/**
 * "Read to me": the browser's own speech, on the device, nothing sent by us.
 * Hidden where speechSynthesis is missing. Pause is cancel-and-remember, the
 * same on every platform (Android's pause() acts like cancel()).
 */
export function ReadAloud({
  targetId,
  locale,
  labels,
}: {
  targetId: string;
  locale: string;
  labels: Labels;
}) {
  const ok = useSyncExternalStore(noop, supported, () => false);
  const [status, setStatus] = useState<Status>("idle");
  const [voice, setVoice] = useState<SpeechSynthesisVoice>();
  const chunks = useRef<string[]>([]);
  const at = useRef(0);
  const run = useRef(0);
  // One play/pause button across every state, so focus can always land on it.
  const playRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ok) return;
    const load = () => setVoice(pickVoice(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    // Silence, and show "Continue" rather than Pause and Stop over silence.
    const interrupt = () => {
      run.current++;
      speechSynthesis.cancel();
      setStatus((s) => (s === "speaking" ? "paused" : s));
    };
    // Back/forward cache: the page comes back with the state it left with.
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) interrupt();
    };
    window.addEventListener("pagehide", interrupt);
    window.addEventListener("pageshow", restore);
    return () => {
      // Also runs when <Activity> hides this page after a navigation, and
      // Activity keeps the state for Back.
      speechSynthesis.removeEventListener("voiceschanged", load);
      window.removeEventListener("pagehide", interrupt);
      window.removeEventListener("pageshow", restore);
      interrupt();
    };
  }, [ok]);

  if (!ok) return null;

  // Stop unmounts when the player goes idle: keep focus off <body>.
  function toIdle() {
    if (stopRef.current && document.activeElement === stopRef.current)
      playRef.current?.focus();
    setStatus("idle");
  }

  function play(from: number) {
    const id = ++run.current;
    speechSynthesis.cancel();
    const say = (k: number) => {
      if (id !== run.current) return;
      if (k >= chunks.current.length) {
        toIdle();
        return;
      }
      at.current = k;
      const u = new SpeechSynthesisUtterance(chunks.current[k]);
      u.lang = voice?.lang ?? locale;
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.onend = () => say(k + 1);
      u.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") toIdle();
      };
      speechSynthesis.speak(u);
    };
    setStatus("speaking");
    say(from);
  }

  const halt = (next: Status) => {
    run.current++;
    speechSynthesis.cancel();
    setStatus(next);
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">{labels.group}</legend>
      <button
        ref={playRef}
        type="button"
        onClick={() => {
          if (status === "speaking") return halt("paused");
          if (status === "paused") return play(at.current);
          chunks.current = toChunks(readableText(targetId), locale);
          play(0);
        }}
        className={
          status === "speaking"
            ? `${BUTTON} border-border-strong bg-surface text-ink hover:bg-surface-muted`
            : `${BUTTON} border-primary bg-primary text-primary-fg hover:bg-primary-hover`
        }
      >
        {status === "speaking" ? (
          <>
            <Pause aria-hidden="true" />
            {labels.pause}
          </>
        ) : (
          <>
            <Play aria-hidden="true" />
            {status === "paused" ? labels.resume : labels.listen}
          </>
        )}
      </button>
      {status !== "idle" ? (
        <button
          ref={stopRef}
          type="button"
          onClick={() => {
            halt("idle");
            playRef.current?.focus();
          }}
          className={`${BUTTON} border-border-strong bg-surface text-ink hover:bg-surface-muted`}
        >
          <Square aria-hidden="true" />
          {labels.stop}
        </button>
      ) : null}
      {status !== "idle" && voice && !voice.localService ? (
        <p className="w-full text-sm text-ink-muted">{labels.onlineVoice}</p>
      ) : null}
    </fieldset>
  );
}
