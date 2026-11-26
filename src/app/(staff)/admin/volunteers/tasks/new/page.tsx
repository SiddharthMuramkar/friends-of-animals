import { connection } from "next/server";
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
import { createTask } from "../../work-actions";
export const instant = false;
export const metadata = {
  title: "Create volunteer task",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: PageProps<"/admin/volunteers/tasks/new">) {
  await connection();
  const actor = await currentActor();
  const [t, loaded, q] = await Promise.all([
    getTranslations("volunteerWork"),
    adminCall(
      () => as(actor).listVolunteerTasks(),
      `${ADMIN_VOLUNTEER_TASKS}/new`
    ),
    searchParams,
  ]);
  if (!loaded.ok) return <AdminDenied />;
  return (
    <WorkFrame title={t("newTask")} staff>
      <WorkNotice result={q.result} />
      <form action={createTask} className={workCard} aria-label={t("newTask")}>
        <label htmlFor="title" className="font-semibold grid gap-2">
          {t("title")}
          <input
            required
            maxLength={150}
            className={inputStyles}
            id="title"
            name="title"
          />
        </label>
        <label htmlFor="description" className="font-semibold grid gap-2">
          {t("description")}
          <textarea
            required
            maxLength={2000}
            id="description"
            name="description"
            aria-describedby="private-help"
            className={inputStyles}
          />
        </label>
        <p id="private-help">{t("noPrivate")}</p>
        <div>
          <SubmitButton pendingLabel={t("saving")}>{t("create")}</SubmitButton>
        </div>
      </form>
    </WorkFrame>
  );
}
