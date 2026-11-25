"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  DASHBOARD_VOLUNTEER_TASKS,
  DASHBOARD_VOLUNTEER_HOURS,
  DASHBOARD_VOLUNTEER_CERTIFICATE,
} from "@/lib/app-routes";
function field(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
async function run(
  path: string,
  call: () => Promise<{ ok: boolean; error?: string }>
) {
  let outcome: string;
  try {
    const result = await call();
    outcome = result.ok ? "saved" : (result.error ?? "error");
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    outcome = "forbidden";
  }
  redirect(`${path}?result=${encodeURIComponent(outcome)}`);
}
export async function taskProgress(
  taskId: string,
  action: "start" | "complete"
) {
  const api = as(await currentActor());
  await run(DASHBOARD_VOLUNTEER_TASKS, () =>
    action === "start"
      ? api.startVolunteerTask({ taskId })
      : api.completeVolunteerTask({ taskId })
  );
}
export async function logHours(formData: FormData) {
  const api = as(await currentActor());
  await run(DASHBOARD_VOLUNTEER_HOURS, () =>
    api.logVolunteerHours({
      taskId: field(formData, "taskId"),
      workedOn: field(formData, "workedOn"),
      minutes: Number(field(formData, "minutes")),
      note: field(formData, "note"),
    })
  );
}
export async function requestServiceCertificate() {
  const api = as(await currentActor());
  await run(DASHBOARD_VOLUNTEER_CERTIFICATE, () =>
    api.requestVolunteerCertificate()
  );
}
