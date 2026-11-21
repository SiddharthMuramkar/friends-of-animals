"use client";

import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form";

/**
 * Says a device was signed out, and takes focus: the button that was
 * pressed has gone with its row, so focus would otherwise drop to the top
 * of the page with nothing announced. The page gives it a new `key` for
 * each sign-out, so it mounts (and takes focus) again.
 */
export function SignedOutNotice({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert tone="success" label={label}>
        {message}
      </FormAlert>
    </div>
  );
}
