"use client";

import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { buttonStyles } from "@/components/site/button-link";
import { cn } from "@/lib/utils";

/**
 * A submit button of a form whose action is a Server Function. While the
 * action runs, every button in the form is disabled, so a second click
 * can't send it twice, and the one that was pressed shows `pendingLabel`.
 * `name` and `value` tell the action which button that was. 44 px tall at
 * least (buttonStyles).
 *
 * A form that sends from `onSubmit` instead (an island that does work in
 * the browser first, so its action is no Server Function) passes the
 * action's own state as `pending`: the form status only follows `action`.
 */
export function SubmitButton({
  children,
  pendingLabel,
  name,
  value,
  pending: given,
  variant,
  size,
  className,
}: {
  children: ReactNode;
  pendingLabel: ReactNode;
  name?: string;
  value?: string;
  pending?: boolean;
  className?: string;
} & VariantProps<typeof buttonStyles>) {
  const status = useFormStatus();
  const pending = given ?? status.pending;
  const pressed =
    pending && (name === undefined || status.data?.get(name) === (value ?? ""));
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pressed || undefined}
      className={cn(buttonStyles({ variant, size }), className)}
    >
      {pressed ? pendingLabel : children}
    </button>
  );
}
