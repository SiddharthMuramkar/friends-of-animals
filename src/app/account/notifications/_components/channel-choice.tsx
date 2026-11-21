import type { ReactNode } from "react";

const CHECKBOX =
  "size-6 shrink-0 rounded-md border-2 border-border-strong accent-primary";

/**
 * One channel a user can choose for their messages (#69): its box, its
 * name, and a hint the box points at, such as the address it reaches.
 */
export function ChannelChoice({
  id,
  name,
  label,
  defaultChecked,
  hint,
}: {
  id: string;
  /** The form field. */
  name: string;
  label: string;
  defaultChecked: boolean;
  hint: ReactNode;
}) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 items-center gap-3 font-semibold text-ink"
      >
        <input
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-describedby={hintId}
          className={CHECKBOX}
        />
        {label}
      </label>
      <div id={hintId} className="ms-9 text-ink-muted wrap-anywhere">
        {hint}
      </div>
    </div>
  );
}
