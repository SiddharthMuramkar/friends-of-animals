"use client";

import { Printer } from "lucide-react";

import { buttonStyles } from "@/components/site/button-link";

/** Opens the browser's print dialog, where "Save as PDF" keeps a copy. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonStyles({ variant: "primary" })}
    >
      <Printer aria-hidden="true" />
      {label}
    </button>
  );
}
