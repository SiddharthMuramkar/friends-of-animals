import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  WorkFrame,
  WorkNotice,
  workCard,
} from "@/components/volunteers/work-ui";
import { SubmitButton, inputStyles } from "@/components/form";
import { ADMIN_VOLUNTEER_TASKS } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../../_lib/boundary";
import { AdminDenied } from "../../../_components/admin-denied";
import { changeTask } from "../../work-actions";
export const instant = false;
export const metadata = {
  title: "Volunteer task details",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/volunteers/tasks/[taskId]">) {
  await connection();
  const actor = await currentActor();
  const [{ taskId }, t, q] = await Promise.all([
    params,
    getTranslations("volunteerWork"),
    searchParams,
  ]);
  const loaded = await adminCall(
    () => as(actor).listVolunteerTasks(),
    `${ADMIN_VOLUNTEER_TASKS}/${taskId}`
  );
  if (!loaded.ok) return <AdminDenied />;
  const task = loaded.value.tasks.find((t) => t.id === taskId);
  if (!task) notFound();
  const canAssign = ["open", "assigned", "in_progress"].includes(task.status);
  const actions =
    task.status === "draft"
      ? (["publish", "cancel"] as const)
      : task.status === "open"
        ? (["cancel"] as const)
        : task.status === "assigned"
          ? (["start", "cancel"] as const)
          : task.status === "in_progress"
            ? (["complete", "cancel"] as const)
            : [];
  const available = loaded.value.volunteers.filter(
    (v) => !task.assignments.some((a) => a.volunteerUserId === v.id)
  );
  return (
    <WorkFrame title={task.title} staff>
      <WorkNotice result={q.result} />
      <section className={workCard}>
        <h2 className="text-h2">{t("taskDetails")}</h2>
        <p>{t(`states.${task.status}`)}</p>
        <p>{task.description}</p>
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <form key={action} action={changeTask.bind(null, task.id, action)}>
              <SubmitButton
                pendingLabel={t("saving")}
                variant={action === "cancel" ? "secondary" : "primary"}
              >
                {t(action)}
              </SubmitButton>
            </form>
          ))}
        </div>
      </section>
      <section className={workCard}>
        <h2 className="text-h2">{t("assigned")}</h2>
        {task.assignments.length === 0 ? (
          <p>{t("noAssignees")}</p>
        ) : (
          <ul className="grid gap-3">
            {task.assignments.map((a) => (
              <li
                key={a.volunteerUserId}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <p>{a.name}</p>
                {canAssign && (
                  <form action={changeTask.bind(null, task.id, "unassign")}>
                    <input
                      type="hidden"
                      name="volunteerUserId"
                      value={a.volunteerUserId}
                    />
                    <SubmitButton
                      variant="secondary"
                      pendingLabel={t("saving")}
                    >
                      {t("unassign")}
                      <span className="sr-only"> {a.name}</span>
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {canAssign && available.length > 0 && (
          <form
            action={changeTask.bind(null, task.id, "assign")}
            className="grid gap-3"
            aria-label={t("assign")}
          >
            <label
              htmlFor="volunteerUserId"
              className="grid gap-2 font-semibold"
            >
              {t("volunteer")}
              <select
                required
                defaultValue=""
                id="volunteerUserId"
                name="volunteerUserId"
                className={inputStyles}
              >
                <option value="" disabled>
                  {t("pickVolunteer")}
                </option>
                {available.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <SubmitButton pendingLabel={t("saving")}>
                {t("assign")}
              </SubmitButton>
            </div>
          </form>
        )}
      </section>
    </WorkFrame>
  );
}
