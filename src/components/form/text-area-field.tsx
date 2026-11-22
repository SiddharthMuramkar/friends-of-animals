import { OctagonAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { inputStyles } from "./text-field";

type TextAreaFieldProps = Omit<
  ComponentProps<"textarea">,
  "id" | "children" | "aria-invalid"
> & {
  /** Also the stem of the hint's and error's ids. Unique on the page. */
  id: string;
  name: string;
  label: ReactNode;
  /** Shown under the label and read out with the textarea. */
  hint?: ReactNode;
  /** Shown above the textarea and read out with it; marks it invalid. */
  error?: ReactNode;
};

/**
 * A labelled textarea with an optional hint and error, wired like
 * TextField. Works in Server and Client Components: it holds no state.
 */
export function TextAreaField({
  id,
  label,
  hint,
  error,
  className,
  ...textarea
}: TextAreaFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="flex items-start gap-2 font-semibold text-danger"
        >
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      <textarea
        {...textarea}
        id={id}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={inputStyles}
      />
    </div>
  );
}
