import { ChevronDown, OctagonAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { inputStyles } from "@/components/form";
import { cn } from "@/lib/utils";

type SelectFieldProps = Omit<
  ComponentProps<"select">,
  "id" | "children" | "aria-invalid"
> & {
  /** Also the stem of the error's id. Unique on the page. */
  id: string;
  name: string;
  label: ReactNode;
  options: { value: string; label: string }[];
  /** The first, empty option, which asks for a choice. */
  placeholder: string;
  /** Shown above the select and read out with it; marks it invalid. */
  error?: ReactNode;
};

/**
 * A labelled native select, styled like the form kit's TextField, with an
 * optional error tied to it with aria-describedby. Route-local: the form
 * kit has no select yet.
 */
export function SelectField({
  id,
  label,
  options,
  placeholder,
  error,
  className,
  ...select
}: SelectFieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
      </label>
      {error ? (
        <p
          id={errorId}
          className="flex items-start gap-2 font-semibold text-danger"
        >
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="relative">
        <select
          {...select}
          id={id}
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          className={cn(inputStyles, "appearance-none pe-11")}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute end-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
        />
      </div>
    </div>
  );
}
