"use client";

import { Pencil } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { buttonStyles } from "@/components/site/button-link";

import type { DoodleLabels } from "./doodle-pad";

// The pad and perfect-freehand load only after the tap.
const DoodlePad = lazy(() =>
  import("./doodle-pad").then((m) => ({ default: m.DoodlePad }))
);

export function DoodleLauncher({
  start,
  loading,
  labels,
}: {
  start: string;
  loading: string;
  labels: DoodleLabels;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonStyles({ size: "lg" })}
      >
        <Pencil aria-hidden="true" />
        {start}
      </button>
    );
  }
  return (
    <Suspense fallback={<p className="text-ink-muted">{loading}</p>}>
      <DoodlePad labels={labels} />
    </Suspense>
  );
}
