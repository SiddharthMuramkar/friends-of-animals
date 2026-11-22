"use client";

import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form";

/**
 * What the last save, publish or refusal did, taking focus: the action
 * redirected back to the editor, so focus would otherwise drop to the top
 * of the page with nothing announced. The page gives it a new `key` for
 * each redirect, so it mounts again.
 */
export function EditorNotice({
  tone,
  label,
  message,
}: {
  tone: "success" | "danger";
  label: string;
  message: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert tone={tone} label={label}>
        {message}
      </FormAlert>
    </div>
  );
}
