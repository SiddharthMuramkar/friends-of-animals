import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import {
  WorkFrame,
  WorkNotice,
  workCard,
} from "@/components/volunteers/work-ui";
import { ButtonLink } from "@/components/site/button-link";
import { ADMIN_VOLUNTEER_TASKS } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
export const instant = false;
export const metadata = {
  title: "Manage volunteer tasks",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: PageProps<"/admin/volunteers/tasks">) {
  await connection();
  const actor = await currentActor();
  const [t, loaded, q] = await Promise.all([
    getTranslations("volunteerWork"),
    adminCall(() => as(actor).listVolunteerTasks(), ADMIN_VOLUNTEER_TASKS),
    searchParams,
  ]);
  if (!loaded.ok) return <AdminDenied />;
  return (
    <WorkFrame title={t("tasks")} lead={t("taskIntro")} staff>
      <WorkNotice result={q.result} />
      <div>
        <ButtonLink href={`${ADMIN_VOLUNTEER_TASKS}/new`}>
          {t("newTask")}
        </ButtonLink>
      </div>
      {loaded.value.tasks.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {loaded.value.tasks.map((task) => (
            <li className={workCard} key={task.id}>
              <h2 className="text-h2">{task.title}</h2>
              <p>{t(`states.${task.status}`)}</p>
              <p>{task.description}</p>
              <p>
                {t("assigned")}:{" "}
                {task.assignments.map((a) => a.name).join(", ") ||
                  t("noAssignees")}
              </p>
              <div>
                <ButtonLink
                  href={`${ADMIN_VOLUNTEER_TASKS}/${task.id}`}
                  variant="secondary"
                >
                  {t("taskDetails")}
                  <span className="sr-only"> {task.title}</span>
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </WorkFrame>
  );
}
