import {
  CircleCheck,
  Info,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "danger";

const TONE: Record<Tone, { icon: LucideIcon; box: string; label: string }> = {
  info: {
    icon: Info,
    box: "border-info-border bg-info-bg",
    label: "text-info",
  },
  success: {
    icon: CircleCheck,
    box: "border-success-border bg-success-bg",
    label: "text-success",
  },
  warning: {
    icon: TriangleAlert,
    box: "border-warning-border bg-warning-bg",
    label: "text-warning",
  },
  danger: {
    icon: OctagonAlert,
    box: "border-danger-border bg-danger-bg",
    label: "text-danger",
  },
};

/**
 * A boxed note. Meaning never rides on colour alone: every tone shows an icon
 * and a word ("Note", "Careful"…), then an optional title.
 */
export async function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = await getTranslations("common.callout");
  const { icon: Icon, box, label } = TONE[tone];
  return (
    <aside
      className={cn("rounded-3xl border-2 p-5 text-ink sm:p-6", box, className)}
    >
      <p className={cn("flex items-center gap-2 font-semibold", label)}>
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <span>{t(tone)}</span>
        {title ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-ink">{title}</span>
          </>
        ) : null}
      </p>
      <div className="mt-2 text-ink [&>*+*]:mt-3">{children}</div>
    </aside>
  );
}
