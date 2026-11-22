"use client";

import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form";

/**
 * Says what the last change did, and takes focus: the button that was
 * pressed has gone (the page shows the other one now), so focus would
 * otherwise drop to the top of the page with nothing announced. The page
 * gives it a new `key` for each change, so it mounts again.
 */
export function ChangeNotice({
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
