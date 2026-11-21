import { CircleCheck, type LucideIcon, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "danger" | "success";

const TONE: Record<
  Tone,
  { icon: LucideIcon; box: string; word: string; role: "alert" | "status" }
> = {
  danger: {
    icon: OctagonAlert,
    box: "border-danger-border bg-danger-bg",
    word: "text-danger",
    role: "alert",
  },
  success: {
    icon: CircleCheck,
    box: "border-success-border bg-success-bg",
    word: "text-success",
    role: "status",
  },
};

/**
 * The outcome of a form submission, for the whole form rather than one
 * field. A problem is announced at once (role="alert"), good news politely
 * (role="status"). Meaning never rides on colour alone: it shows an icon and
 * a word (`label`, e.g. common.callout.danger, "Important"). Holds no state,
 * so it works in Client Components, which can't render <Callout>.
 */
export function FormAlert({
  tone,
  label,
  children,
  className,
}: {
  tone: Tone;
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { icon: Icon, box, word, role } = TONE[tone];
  return (
    <div
      role={role}
      className={cn("rounded-3xl border-2 p-5 text-ink sm:p-6", box, className)}
    >
      <p className={cn("flex items-center gap-2 font-semibold", word)}>
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <span>{label}</span>
      </p>
      <div className="mt-2 text-ink">{children}</div>
    </div>
  );
}
