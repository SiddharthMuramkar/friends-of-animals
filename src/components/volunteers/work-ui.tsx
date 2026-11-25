import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  ADMIN_VOLUNTEERS,
  ADMIN_VOLUNTEER_HOURS,
  ADMIN_VOLUNTEER_TASKS,
  DASHBOARD_VOLUNTEER,
  DASHBOARD_VOLUNTEER_HOURS,
  DASHBOARD_VOLUNTEER_TASKS,
  DASHBOARD_VOLUNTEER_CERTIFICATE,
} from "@/lib/app-routes";
import type { UseCases } from "@/server/app";
import { splitMinutes } from "@/server/modules/volunteers/domain/hours";

export const workCard =
  "min-w-0 break-words rounded-3xl border-2 border-border bg-surface p-5 sm:p-6 grid gap-4";
export async function WorkFrame({
  title,
  lead,
  staff = false,
  children,
}: {
  title: string;
  lead?: string;
  staff?: boolean;
  children: ReactNode;
}) {
  return (
    <Section hue="green" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={title} lead={lead} />
      <div className="mt-6">
        <WorkLinks staff={staff} />
      </div>
      <div className="mt-8 grid gap-6">{children}</div>
    </Section>
  );
}
export async function WorkLinks({ staff = false }: { staff?: boolean }) {
  const t = await getTranslations("volunteerWork");
  return (
    <div className="flex flex-wrap gap-3">
      {(staff
        ? [
            [ADMIN_VOLUNTEERS, t("applicationBack")],
            [ADMIN_VOLUNTEER_TASKS, t("tasks")],
            [ADMIN_VOLUNTEER_HOURS, t("hoursReview")],
          ]
        : [
            [DASHBOARD_VOLUNTEER, t("dashboardBack")],
            [DASHBOARD_VOLUNTEER_TASKS, t("myTasks")],
            [DASHBOARD_VOLUNTEER_HOURS, t("myHours")],
            [DASHBOARD_VOLUNTEER_CERTIFICATE, t("myCertificate")],
          ]
      ).map(([href, label]) => (
        <ButtonLink key={href} href={href!} variant="secondary">
          {label}
        </ButtonLink>
      ))}
    </div>
  );
}
const outcomes = [
  "not_volunteer",
  "task_not_accepting_hours",
  "worked_on_in_future",
  "before_assignment",
  "after_unassignment",
  "day_limit_exceeded",
  "nothing_to_certify",
  "certificate_revoked",
  "forbidden",
] as const;
export async function WorkNotice({ result }: { result: unknown }) {
  if (typeof result !== "string") return null;
  const t = await getTranslations("volunteerWork");
  return result === "saved" ? (
    <output className="block font-semibold">{t("saved")}</output>
  ) : (
    <p role="alert" className="font-semibold">
      {t(outcomes.find((x) => x === result) ?? "error")}
    </p>
  );
}
export type RecordView = Awaited<ReturnType<UseCases["getMyVolunteerRecord"]>>;
export async function HoursHistory({ record }: { record: RecordView }) {
  const t = await getTranslations("volunteerWork");
  return (
    <section className={workCard}>
      <h2 className="text-h2">
        {t("approvedTotal", splitMinutes(record.approvedMinutes))}
      </h2>
      {record.entries.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="grid gap-3">
          {record.entries.map((entry) => (
            <li
              key={entry.id}
              className="border-t border-border pt-3 grid gap-1"
            >
              <h3 className="font-semibold">{entry.taskTitle}</h3>
              <p>
                <time dateTime={entry.workedOn}>{entry.workedOn}</time> ·{" "}
                {t("duration", splitMinutes(entry.minutes))} ·{" "}
                {t(`hourStates.${entry.status}`)}
              </p>
              {entry.note && <p>{entry.note}</p>}
              {entry.rejectReason && (
                <p>
                  {t("reason")}: {entry.rejectReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
