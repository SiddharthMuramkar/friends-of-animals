import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Chip } from "@/components/site/chip";
import type { VolunteerApplicationView } from "@/server/modules/volunteers";
import {
  DAY_PARTS,
  WEEKDAYS,
} from "@/server/modules/volunteers/domain/application-input";
import type { VolunteerApplicationStatus } from "@/server/modules/volunteers/domain/application-status";

// One volunteer application as its applicant, their guardian or the
// community team reads it (#123): where it stands, in words for whoever
// reads it, then what the applicant offered. A server component.

/** Status words come with a tone; never colour alone. */
export const STATUS_TONE: Record<
  VolunteerApplicationStatus,
  "neutral" | "blue" | "green" | "pink" | "marigold"
> = {
  awaiting_guardian: "marigold",
  submitted: "blue",
  approved: "green",
  guardian_declined: "pink",
  declined: "pink",
  withdrawn: "neutral",
};

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="font-semibold text-ink sm:w-44 sm:shrink-0">{term}</dt>
      <dd className="min-w-0 text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}

export async function ApplicationSummary({
  application,
  audience,
  name,
}: {
  application: VolunteerApplicationView;
  /** Who reads it: the applicant, their guardian, or the community team. */
  audience: "self" | "guardian" | "staff";
  /** The applicant's name, for a guardian or the community team. */
  name?: string;
}) {
  const [t, interests, format] = await Promise.all([
    getTranslations("volunteer.summary"),
    getTranslations("volunteer.interests"),
    getFormatter(),
  ]);
  const { status } = application;
  const byDay = WEEKDAYS.map((day, index) => ({
    day: format.dateTime(new Date(Date.UTC(2023, 0, 2 + index, 12)), {
      weekday: "long",
      timeZone: "UTC",
    }),
    parts: DAY_PARTS.filter((part) =>
      application.availability.slots.some(
        (slot) => slot.day === day && slot.part === part
      )
    ).map((part) => t(`parts.${part}`)),
  })).filter((entry) => entry.parts.length > 0);
  const open = status === "awaiting_guardian" || status === "submitted";
  const outdated =
    open &&
    (application.declarations.safeguarding !== "current" ||
      application.declarations.conduct !== "current");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Chip tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Chip>
      </div>
      <p className="text-ink">
        {t(`explain.${audience}.${status}`, { name: name ?? "" })}
      </p>
      {status === "declined" && application.declineReason ? (
        <p className="rounded-2xl border-2 border-border bg-surface-muted p-4 whitespace-pre-line text-ink wrap-anywhere">
          {t("reason", { reason: application.declineReason })}
        </p>
      ) : null}
      {outdated ? (
        <p className="text-ink">{t(`outdated.${audience}`)}</p>
      ) : null}
      <dl className="flex flex-col gap-3">
        <Detail term={t("applied")}>
          {format.dateTime(application.createdAt, "long")}
        </Detail>
        <Detail term={t("interests")}>
          {format.list(
            application.interests.map((interest) => interests(interest)),
            "and"
          )}
        </Detail>
        <Detail term={t("availability")}>
          <ul className="flex flex-col gap-1">
            {byDay.map((entry) => (
              <li key={entry.day}>
                {t("slot", {
                  day: entry.day,
                  parts: format.list(entry.parts, "and"),
                })}
              </li>
            ))}
          </ul>
        </Detail>
        {application.availability.note ? (
          <Detail term={t("note")}>{application.availability.note}</Detail>
        ) : null}
      </dl>
    </div>
  );
}
