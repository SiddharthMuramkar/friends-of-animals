"use server";

import { notFound, redirect, RedirectType } from "next/navigation";
import {
  DASHBOARD_COMMUNITY,
  guardianChildTimelinePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";

export async function memberAction(
  childId: string | null,
  action: "join" | "update" | "leave",
  formData: FormData
) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const target = childId ? { childId } : {};
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const profile = {
    ...target,
    displayName: text("displayName"),
    about: text("about"),
  };
  const api = as(actor);
  let done: string;
  try {
    const result = await (action === "leave"
      ? api.leaveCommunity(target)
      : action === "update"
        ? api.updateMemberProfile(profile)
        : api.joinCommunity(profile));
    done = result.ok
      ? action === "leave"
        ? "left"
        : action === "update"
          ? "updated"
          : "joined"
      : result.error;
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw new Error(`Community action failed: ${errorSummaryForLogs(error)}`);
  }
  const path = childId
    ? guardianChildTimelinePath(childId)
    : DASHBOARD_COMMUNITY;
  redirect(
    `${path}?${new URLSearchParams({ done, n: Date.now().toString(36) })}`,
    RedirectType.replace
  );
}
