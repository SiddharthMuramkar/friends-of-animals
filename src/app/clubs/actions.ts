"use server";
import { notFound, redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { CLUB_APPLY, clubPath, adminClubPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { z } from "zod";

const text = (data: FormData, key: string) => {
  const field = data.get(key);
  return typeof field === "string" ? field : "";
};
const kind = (data: FormData) => {
  const parsed = z.enum(["student", "teacher"]).safeParse(text(data, "kind"));
  return parsed.success ? parsed.data : undefined;
};
const done = (path: string, outcome: string) =>
  `${path}?${new URLSearchParams({ done: outcome, n: Date.now().toString(36) })}`;
export async function applyClubAction(data: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  let path: string;
  try {
    const reply = await as(actor).applyForClub({
      institutionId: text(data, "institutionId"),
      name: text(data, "name"),
      kind: kind(data),
    });
    path = reply.ok
      ? done(clubPath(reply.clubId), "applied")
      : done(CLUB_APPLY, reply.error);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw new Error(`Club application failed: ${errorSummaryForLogs(error)}`);
  }
  redirect(path);
}
export async function clubAction(
  clubId: string,
  action:
    | "join"
    | "leave"
    | "withdraw"
    | "approve"
    | "decline"
    | "suspend"
    | "close",
  data: FormData
) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const api = as(actor);
  const input = { clubId, reason: text(data, "reason") };
  const path =
    action === "join" || action === "leave" || action === "withdraw"
      ? clubPath(clubId)
      : adminClubPath(clubId);
  let outcome: string;
  try {
    const reply = await (action === "join"
      ? api.joinClub({ clubId, kind: kind(data) })
      : action === "leave"
        ? api.leaveClub({ clubId })
        : action === "withdraw"
          ? api.withdrawClubApplication(input)
          : action === "approve"
            ? api.approveClub(input)
            : action === "decline"
              ? api.declineClub(input)
              : action === "suspend"
                ? api.suspendClub(input)
                : api.closeClub(input));
    outcome = reply.ok
      ? action === "join"
        ? "joined"
        : action === "leave"
          ? "left"
          : "saved"
      : reply.error;
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw new Error(`Club action failed: ${errorSummaryForLogs(error)}`);
  }
  redirect(done(path, outcome));
}
