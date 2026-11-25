import { getTranslations } from "next-intl/server";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { inputStyles } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { Suspense, type ReactNode } from "react";
export const card =
  "min-w-0 break-words rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
export async function ClubShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const t = await getTranslations("clubs");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader tile="green" title={title} lead={lead} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <div className="mt-8 flex flex-col gap-5">{children}</div>
      </Suspense>
    </Section>
  );
}
export async function ClaimField({ id }: { id: string }) {
  const t = await getTranslations("clubs");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {t("kind")}
      </label>
      <p className="text-sm text-ink-muted" id={`${id}-hint`}>
        {t("attestHint")}
      </p>
      <select
        required
        name="kind"
        id={id}
        defaultValue=""
        aria-describedby={`${id}-hint`}
        className={`${inputStyles} min-w-0 w-full`}
      >
        <option value="" disabled>
          {t("chooseKind")}
        </option>
        <option value="student">{t("affiliation.student")}</option>
        <option value="teacher">{t("affiliation.teacher")}</option>
      </select>
    </div>
  );
}
const outcomes = [
  "saved",
  "applied",
  "joined",
  "left",
  "invalid_input",
  "clubs_closed",
  "institution_not_verified",
  "not_at_institution",
  "application_pending",
  "club_limit_reached",
  "transition_not_allowed",
  "reason_required",
  "reason_too_long",
  "club_not_open",
  "already_member",
  "not_member",
  "applicant_missing",
] as const;
export async function ClubOutcome({
  query,
}: {
  query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("clubs");
  const common = await getTranslations("common.callout");
  const result = outcomes.find((o) => o === query.done);
  if (!result) return null;
  const success = ["saved", "applied", "joined", "left"].includes(result);
  return (
    <OutcomeNotice
      key={typeof query.n === "string" ? query.n : result}
      tone={success ? "success" : "danger"}
      label={common(success ? "success" : "danger")}
      message={t(`outcome.${result}`)}
    />
  );
}
