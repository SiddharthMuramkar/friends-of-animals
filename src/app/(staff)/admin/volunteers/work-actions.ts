"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ADMIN_VOLUNTEER_TASKS, ADMIN_VOLUNTEER_HOURS } from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";
async function run(
  path: string,
  call: () => Promise<{ ok: boolean; error?: string }>
) {
  const result = await adminCall(call, path);
  const outcome = result.ok
    ? result.value.ok
      ? "saved"
      : (result.value.error ?? "error")
    : "forbidden";
  redirect(`${path}?result=${encodeURIComponent(outcome)}`);
}
export async function createTask(data: FormData) {
  const api = as(await currentActor());
  const path = `${ADMIN_VOLUNTEER_TASKS}/new`;
  const result = await adminCall(
    () =>
      api.createVolunteerTask({
        title: String(data.get("title") ?? ""),
        description: String(data.get("description") ?? ""),
      }),
    path
  );
  if (result.ok && result.value.ok)
    redirect(`${ADMIN_VOLUNTEER_TASKS}/${result.value.taskId}?result=saved`);
  redirect(`${path}?result=error`);
}
type Change =
  | "publish"
  | "assign"
  | "unassign"
  | "start"
  | "complete"
  | "cancel";
export async function changeTask(
  taskId: string,
  action: Change,
  data: FormData
) {
  const api = as(await currentActor());
  const input = {
    taskId,
    volunteerUserId: String(data.get("volunteerUserId") ?? ""),
  };
  await run(`${ADMIN_VOLUNTEER_TASKS}/${taskId}`, () => {
    switch (action) {
      case "publish":
        return api.publishVolunteerTask(input);
      case "assign":
        return api.assignVolunteerTask(input);
      case "unassign":
        return api.unassignVolunteerTask(input);
      case "start":
        return api.startVolunteerTask(input);
      case "complete":
        return api.completeVolunteerTask(input);
      case "cancel":
        return api.cancelVolunteerTask(input);
    }
  });
}
export async function decideHours(
  entryId: string,
  decision: "approve" | "reject",
  data: FormData
) {
  const api = as(await currentActor());
  await run(ADMIN_VOLUNTEER_HOURS, () =>
    decision === "approve"
      ? api.approveVolunteerHours({ entryId })
      : api.rejectVolunteerHours({
          entryId,
          reason: String(data.get("reason") ?? ""),
        })
  );
}
export async function correctCertificate(
  certificateId: string,
  action: "retry" | "revoke" | "reissue",
  data: FormData
) {
  const api = as(await currentActor());
  await run(ADMIN_VOLUNTEER_HOURS, () => {
    const reason = String(data.get("reason") ?? "");
    switch (action) {
      case "retry":
        return api.retryCertificateRender({ certificateId });
      case "revoke":
        return api.revokeCertificate({ certificateId, reason });
      case "reissue":
        return api.reissueCertificate({
          certificateId,
          reason,
          recipientName: String(data.get("recipientName") ?? ""),
        });
    }
  });
}
