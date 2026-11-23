"use client";

import { useEffect, useRef } from "react";

// Through the kit's index, not ./form-alert: a second importer of
// form-alert splits the kit's chunk and adds bytes to every page using it.
import { FormAlert } from "@/components/form";

/**
 * Says what a button that posted and came back to the page did (removing a
 * coordinator, registering for a competition), and takes focus: the button
 * that was pressed has gone or changed with its row, so focus would
 * otherwise drop to the top of the page with nothing announced. The page
 * gives it a new `key` each time, so it mounts (and takes focus) again.
 *
 * It says so once: having taken focus, it drops `done` and `n` from the
 * address with the history API, keeping the rest (which institution is
 * open), so a reload doesn't announce it a second time.
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
