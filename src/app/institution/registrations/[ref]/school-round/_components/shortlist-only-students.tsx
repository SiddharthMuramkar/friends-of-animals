import { getFormatter, getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/site/heading";
import { EntryStatusChip } from "@/app/participant/entries/_components/entry-status";
import { typeNameKeys } from "@/app/account/files/_lib/upload";
import { uploadRuleFor } from "@/server/modules/entries/rules";
import { SHORTLIST_ONLY_DECLARATIONS } from "@/server/modules/school-round/domain/shortlist-only";
import type { SchoolRoundView } from "@/server/modules/school-round";
import {
  ShortlistedEntryForm,
  type ShortlistedLabels,
} from "./shortlisted-entry-form";

const ERRORS = [
  "not_found",
  "not_shortlist_only",
  "not_open",
  "round_not_editable",
  "student_not_found",
  "registration_not_confirmed",
  "entry_locked",
  "discipline_not_offered",
  "discipline_required",
  "empty",
  "wrong_type",
  "too_large",
  "too_long",
  "upload_limit",
  "shortlist_invalid",
  "shortlist_full",
  "position_out_of_range",
  "position_taken",
  "declarations_invalid",
  "file_not_found",
  "upload_missing",
  "upload_rejected",
  "invalid_input",
  "signed_out",
  "forbidden",
  "storage_unavailable",
  "unknown",
] as const;

export async function ShortlistOnlyStudents({
  round,
  institutionId,
}: {
  round: SchoolRoundView;
  institutionId: string;
}) {
  const [t, discipline, files, format] = await Promise.all([
    getTranslations("schoolRound.shortlistOnly"),
    getTranslations("schoolRound.discipline"),
    getTranslations("files.types"),
    getFormatter(),
  ]);
  const labels: Omit<ShortlistedLabels, "heading" | "submit"> = {
    discipline: t("discipline"),
    choose: t("choose"),
    title: t("titleField"),
    description: t("description"),
    statement: t("statement"),
    position: t("position"),
    noPosition: t("noPosition"),
    declarations: t("declarations"),
    file: t("file"),
    photoHint: t("photoHint"),
    busy: t("busy"),
    declarationLabels: Object.fromEntries(
      SHORTLIST_ONLY_DECLARATIONS.map((key) => [key, t(`declaration.${key}`)])
    ) as ShortlistedLabels["declarationLabels"],
    problem: t("problem"),
    errors: Object.fromEntries(ERRORS.map((key) => [key, t(`errors.${key}`)])),
  };
  return (
    <section
      aria-labelledby="round-shortlisted-students"
      className="flex flex-col gap-4"
    >
      <SectionHeading id="round-shortlisted-students" title={t("title")} />
      <p className="text-ink">{t("lead")}</p>
      <ul className="flex flex-col gap-4">
        {round.students.map((student) => {
          const entry = student.entry;
          const retry =
            entry?.status === "school_shortlisted" &&
            !entry.hasLiveFile &&
            (entry.upload === "failed" || entry.upload === "rejected");
          const editable =
            round.canEdit && (!entry || entry.status === "school_shortlisted");
          const canRetry =
            retry && round.competition.status === "school_judging";
          const choices = student.disciplines.flatMap((value) => {
            const rule = uploadRuleFor(value);
            if (!rule) return [];
            return [
              {
                value,
                rule,
                label: discipline(value),
                hint: t("limit", {
                  types: format.list(
                    typeNameKeys(rule.acceptedTypes).map((key) => files(key)),
                    { type: "disjunction" }
                  ),
                  size: format.number(rule.maxBytes / 1024 / 1024),
                }),
              },
            ];
          });
          return (
            <li
              key={student.registrationId}
              className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
            >
              <h3 className="wrap-anywhere">{student.name}</h3>
              <p className="mt-1 font-mono text-sm text-ink-muted wrap-anywhere">
                {student.registrationNumber} · {student.ageGroupLabel}
              </p>
              {entry ? (
                <>
                  <p className="mt-2 text-ink wrap-anywhere">
                    <span className="font-mono">{entry.code}</span> ·{" "}
                    {entry.title} · {discipline(entry.discipline)}
                  </p>
                  <p className="mt-2">
                    <EntryStatusChip status={entry.status} />
                  </p>
                  {entry.position ? (
                    <p className="mt-2 text-ink">
                      {t("placed", { position: entry.position })}
                    </p>
                  ) : null}
                  {entry.upload ? (
                    <p className="mt-2 text-ink-muted">
                      {t(`upload.${entry.upload}`)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-ink-muted">
                  {t(round.finalised ? "notShortlisted" : "noEntry")}
                </p>
              )}
              {(editable || canRetry) && choices.length ? (
                <ShortlistedEntryForm
                  key={`${student.registrationId}-${entry?.upload ?? "new"}`}
                  student={student}
                  institutionId={institutionId}
                  reference={round.reference}
                  canEdit={round.canEdit}
                  positions={round.limits.positions}
                  choices={choices}
                  labels={{
                    ...labels,
                    heading: t(entry ? "replaceFor" : "createFor", {
                      name: student.name,
                    }),
                    submit: t(entry ? "replace" : "create"),
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
