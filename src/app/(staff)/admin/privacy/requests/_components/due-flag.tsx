import { AlarmClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";

/**
 * How a request stands against its due date: an icon and a word when it
 * is overdue, never colour alone; days left otherwise (#115).
 */
export async function DueFlag({
  overdue,
  daysLeft,
}: {
  overdue: boolean;
  daysLeft: number | null;
}) {
  if (daysLeft === null) return null;
  const t = await getTranslations("adminGrievance.due");
  if (overdue) {
    return (
      <span className="flex flex-col items-start gap-1">
        <Chip tone="pink" icon={<AlarmClock aria-hidden="true" />}>
          {t("overdue")}
        </Chip>
        <span className="text-sm text-ink-muted">
          {daysLeft < 0
            ? t("late", { days: -daysLeft })
            : t("daysLeft", { days: 0 })}
        </span>
      </span>
    );
  }
  return (
    <span className="text-sm text-ink-muted">
      {t("daysLeft", { days: daysLeft })}
    </span>
  );
}
