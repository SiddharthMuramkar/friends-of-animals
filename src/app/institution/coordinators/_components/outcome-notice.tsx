"use client";

import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form";

/**
 * Says what a remove or withdraw button did, and takes focus: the button
 * that was pressed has gone with its row, so focus would otherwise drop to
 * the top of the page with nothing announced. The page gives it a new `key`
 * each time, so it mounts (and takes focus) again.
 *
 * It says so once: having taken focus, it drops `done` and `n` from the
 * address with the history API, keeping which institution is open, so a
 * reload doesn't announce it a second time.
 */
export function OutcomeNotice({
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
    const url = new URL(window.location.href);
    url.searchParams.delete("done");
    url.searchParams.delete("n");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert tone={tone} label={label}>
        {message}
      </FormAlert>
    </div>
  );
}
