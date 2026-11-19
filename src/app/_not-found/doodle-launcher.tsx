"use client";

import { Pencil, RotateCcw } from "lucide-react";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import { buttonStyles } from "@/components/site/button-link";

import type { DoodleLabels } from "./doodle-pad";

// The pad and perfect-freehand load only after the tap. Each attempt makes
// a new lazy component, so Try again fetches the code again.
function loadPad() {
  return lazy(() =>
    import("./doodle-pad").then((m) => ({ default: m.DoodlePad }))
  );
}

/**
 * Shows `fallback` in place of the pad when its code fails to load (a flaky
 * connection), so the rest of the 404 page, with its ways back, stays.
 */
class PadErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function LoadFailed({
  message,
  retry,
  onRetry,
}: {
  message: string;
  retry: string;
  onRetry: () => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  // The launcher button is gone: keep focus in the pad's place.
  useEffect(() => {
    retryRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p id="doodle-load-failed" className="text-ink">
        {message}
      </p>
      <button
        ref={retryRef}
        type="button"
        onClick={onRetry}
        aria-describedby="doodle-load-failed"
        className={buttonStyles({ variant: "secondary" })}
      >
        <RotateCcw aria-hidden="true" />
        {retry}
      </button>
    </div>
  );
}

export function DoodleLauncher({
  start,
  loading,
  loadFailed,
  retry,
  labels,
}: {
  start: string;
  loading: string;
  loadFailed: string;
  retry: string;
  labels: DoodleLabels;
}) {
  const [Pad, setPad] = useState<ReturnType<typeof loadPad> | null>(null);
  const [attempt, setAttempt] = useState(0);
  if (!Pad) {
    return (
      <button
        type="button"
        onClick={() => setPad(loadPad)}
        className={buttonStyles({ size: "lg" })}
      >
        <Pencil aria-hidden="true" />
        {start}
      </button>
    );
  }
  return (
    <PadErrorBoundary
      key={attempt}
      fallback={
        <LoadFailed
          message={loadFailed}
          retry={retry}
          onRetry={() => {
            setPad(loadPad);
            setAttempt((n) => n + 1);
          }}
        />
      }
    >
      <Suspense fallback={<p className="text-ink-muted">{loading}</p>}>
        <Pad labels={labels} />
      </Suspense>
    </PadErrorBoundary>
  );
}
