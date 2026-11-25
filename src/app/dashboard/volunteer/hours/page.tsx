import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import {
  WorkFrame,
  WorkNotice,
  HoursHistory,
  workCard,
} from "@/components/volunteers/work-ui";
import { inputStyles, SubmitButton } from "@/components/form";
import { acceptsHours } from "@/server/modules/volunteers/domain/task-status";
import { ownVolunteerRecord } from "../work-loader";
import { logHours } from "../work-actions";
export const instant = false;
export const metadata = {
  title: "Your volunteer hours",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: PageProps<"/dashboard/volunteer/hours">) {
  await connection();
  const [t, record, q] = await Promise.all([
    getTranslations("volunteerWork"),
    ownVolunteerRecord(),
    searchParams,
  ]);
  const tasks = record.tasks.filter((t) => acceptsHours(t.status));
  return (
    <WorkFrame title={t("myHours")} lead={t("hoursIntro")}>
      <WorkNotice result={q.result} />
      <HoursHistory record={record} />
      {tasks.length > 0 && (
        <form
          action={logHours}
          className={workCard}
          aria-labelledby="log-heading"
        >
          <h2 id="log-heading" className="text-h2">
            {t("log")}
          </h2>
          <label className="grid gap-2 font-semibold" htmlFor="taskId">
            {t("taskRequired")}
            <select required id="taskId" name="taskId" className={inputStyles}>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 font-semibold" htmlFor="workedOn">
            {t("workedOn")}
            <input
              required
              id="workedOn"
              name="workedOn"
              type="date"
              className={inputStyles}
            />
          </label>
          <label className="grid gap-2 font-semibold" htmlFor="minutes">
            {t("minutes")}
            <input
              required
              id="minutes"
              name="minutes"
              type="number"
              min={1}
              max={1440}
              step={1}
              className={inputStyles}
            />
          </label>
          <label htmlFor="note" className="grid gap-2 font-semibold">
            {t("note")}
            <textarea
              id="note"
              name="note"
              maxLength={500}
              className={inputStyles}
            />
          </label>
          <div>
            <SubmitButton pendingLabel={t("saving")}>{t("log")}</SubmitButton>
          </div>
        </form>
      )}
    </WorkFrame>
  );
}
