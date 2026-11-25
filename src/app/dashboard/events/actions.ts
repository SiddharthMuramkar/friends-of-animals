"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { DASHBOARD_EVENTS, guardianChildEventsPath } from "@/lib/app-routes";
import { slugHref } from "@/lib/routes";

function destination(slug: string | null, childId?: string) {
  return childId
    ? guardianChildEventsPath(childId)
    : slug
      ? slugHref("event", slug)
      : DASHBOARD_EVENTS;
}
export async function register(
  eventId: string,
  slug: string | null,
  childId?: string
) {
  let outcome: string;
  const actor = await currentActor();
  try {
    const result = await as(actor).registerForEvent({ eventId, childId });
    outcome = result.ok ? result.status : result.error;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    outcome = "forbidden";
  }
  redirect(
    destination(slug, childId) + "?result=" + encodeURIComponent(outcome)
  );
}
export async function cancel(
  registrationId: string,
  slug: string | null,
  childId?: string
) {
  let outcome: string;
  try {
    const result = await as(await currentActor()).cancelEventRegistration({
      registrationId,
    });
    outcome = result.ok ? "ok" : result.error;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    outcome = "forbidden";
  }
  redirect(
    destination(slug, childId) + "?result=" + encodeURIComponent(outcome)
  );
}
