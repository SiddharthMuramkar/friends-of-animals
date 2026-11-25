"use server";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { as, currentActor } from "@/server/app";
import {
  ADMIN_NEW_EVENT,
  adminEventPath,
  eventRegistrationsPath,
  eventCheckInPath,
} from "@/lib/app-routes";
import { istLocalToInstant } from "@/server/modules/competitions/domain/ist";
import type { EventDetailsInput } from "@/server/modules/events/domain/event-details";
import { adminCall } from "../_lib/boundary";

function formInput(form: FormData): EventDetailsInput {
  const field = (name: string) => String(form.get(name) ?? "");
  const optional = (name: string) => field(name).trim() || null;
  const instant = (name: string) => {
    const parsed = istLocalToInstant(field(name));
    return parsed.ok ? parsed.at : new Date(NaN);
  };
  return {
    kind: field("kind") as EventDetailsInput["kind"],
    title: field("title"),
    summary: field("summary"),
    description: field("description"),
    startsAt: instant("startsAt"),
    endsAt: instant("endsAt"),
    venueName: optional("venueName"),
    address: optional("address"),
    city: optional("city"),
    pinCode: optional("pinCode"),
    onlineUrl: optional("onlineUrl"),
    capacity: optional("capacity") === null ? null : Number(field("capacity")),
    audience: field("audience") as EventDetailsInput["audience"],
    registrationOpensAt:
      optional("registrationOpensAt") === null
        ? null
        : instant("registrationOpensAt"),
    registrationClosesAt:
      optional("registrationClosesAt") === null
        ? null
        : instant("registrationClosesAt"),
    waitlistEnabled: form.get("waitlistEnabled") === "on",
  };
}
const withResult = (path: string, result: string) =>
  path + "?result=" + encodeURIComponent(result);
export async function create(form: FormData) {
  const run = await adminCall(
    async () => as(await currentActor()).createEvent(formInput(form)),
    ADMIN_NEW_EVENT
  );
  if (run.ok && run.value.ok) redirect(adminEventPath(run.value.eventId));
  redirect(
    withResult(
      ADMIN_NEW_EVENT,
      run.ok && !run.value.ok ? run.value.error : "forbidden"
    )
  );
}
export async function update(eventId: string, form: FormData) {
  const path = adminEventPath(eventId);
  const run = await adminCall(
    async () =>
      as(await currentActor()).updateEvent({ eventId, ...formInput(form) }),
    path
  );
  if (run.ok && run.value.ok) updateTag("events-sitemap");
  redirect(
    withResult(
      path,
      !run.ok ? "forbidden" : run.value.ok ? "ok" : run.value.error
    )
  );
}
export async function move(
  eventId: string,
  move: "publish" | "cancel" | "complete"
) {
  const path = adminEventPath(eventId);
  const run = await adminCall(async () => {
    const api = as(await currentActor());
    if (move === "publish") return api.publishEvent({ eventId });
    if (move === "cancel") return api.cancelEvent({ eventId });
    return api.completeEvent({ eventId });
  }, path);
  if (run.ok && run.value.ok) updateTag("events-sitemap");
  redirect(
    withResult(
      path,
      !run.ok ? "forbidden" : run.value.ok ? "ok" : run.value.error
    )
  );
}
export async function cancelBooking(eventId: string, registrationId: string) {
  const path = eventRegistrationsPath(eventId);
  const run = await adminCall(
    async () =>
      as(await currentActor()).cancelEventRegistration({ registrationId }),
    path
  );
  redirect(
    withResult(
      path,
      !run.ok ? "forbidden" : run.value.ok ? "ok" : run.value.error
    )
  );
}
export async function checkIn(eventId: string, registrationId: string) {
  const path = eventCheckInPath(eventId);
  const run = await adminCall(
    async () => as(await currentActor()).checkInAttendee({ registrationId }),
    path
  );
  redirect(
    withResult(
      path,
      !run.ok ? "forbidden" : run.value.ok ? "ok" : run.value.error
    )
  );
}
