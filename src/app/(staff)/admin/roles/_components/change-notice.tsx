"use client";

import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form";

/**
 * Says what a grant or revoke did, and takes focus: the page reloaded and
 * the pressed button may have gone with its grant, so focus would
 * otherwise drop to the top with nothing announced. The page keys it on
 * the change's token, so each change mounts it (and moves focus) again.
 */
export function ChangeNotice({
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
