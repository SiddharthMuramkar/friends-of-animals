"use client";

import { useEffect, useRef } from "react";

import { FormAlert } from "@/components/form";

/**
 * Says a version was published, and takes focus: the form that was used
 * has reset to the new current version, so focus would otherwise drop to
 * the top of the page with nothing announced. The page gives it a new
 * `key` for each publish, so it mounts again.
 */
export function PublishedNotice({
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
