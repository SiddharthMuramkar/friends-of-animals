import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import {
  WorkFrame,
  WorkNotice,
  workCard,
} from "@/components/volunteers/work-ui";
import { SubmitButton } from "@/components/form";
import { ownVolunteerRecord } from "../work-loader";
import { taskProgress } from "../work-actions";
export const instant = false;
export const metadata = {
  title: "Your volunteer tasks",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: PageProps<"/dashboard/volunteer/tasks">) {
  await connection();
  const [t, record, q] = await Promise.all([
    getTranslations("volunteerWork"),
    ownVolunteerRecord(),
    searchParams,
  ]);
  return (
    <WorkFrame title={t("myTasks")} lead={t("mineIntro")}>
      <WorkNotice result={q.result} />
      {record.tasks.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {record.tasks.map((task) => (
            <li key={task.id} className={workCard}>
              <h2 className="text-h2">{task.title}</h2>
              <p>
                {t(`states.${task.status}`)}
                {task.unassignedAt ? ` · ${t("unassigned")}` : ""}
              </p>
              <p>{task.description}</p>
              {!task.unassignedAt &&
                (task.status === "assigned" ||
                  task.status === "in_progress") && (
                  <form
                    action={taskProgress.bind(
                      null,
                      task.id,
                      task.status === "assigned" ? "start" : "complete"
                    )}
                  >
                    <SubmitButton pendingLabel={t("saving")}>
                      {t(task.status === "assigned" ? "start" : "complete")}
                    </SubmitButton>
                  </form>
                )}
            </li>
          ))}
        </ul>
      )}
    </WorkFrame>
  );
}
