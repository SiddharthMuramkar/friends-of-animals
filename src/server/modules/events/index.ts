// The events module (#125): events and campaigns that people sign up to.
// Its use cases join `as(actor)` through `eventsUseCases`.
//
// Access control (#59) isn't in this branch yet, so the use cases take the
// access they authorize and audit through (./access.ts): the app passes
// `accessBeforeRoles`, Seam 1 tests pass test access (./testing.ts).

import type { UseCaseContext } from "../../use-cases";
import { accessBeforeRoles, type EventsAccess } from "./access";
import type { EventDetailsInput } from "./domain/event-details";
import { getPublicEvent, listPublishedEvents } from "./public-reads";
import { createEvent, getEventForAdmin, listEventsForAdmin } from "./use-cases";

export type {
  GetPublicEventResult,
  PublicEvent,
  PublicEventSummary,
} from "./public-reads";
export type {
  AdminEvent,
  CreateEventResult,
  EventProblem,
  GetEventForAdminResult,
} from "./use-cases";

/** The events use cases, authorizing and auditing through `access`. */
export function eventsModule(access: EventsAccess) {
  return (ctx: UseCaseContext) => ({
    createEvent: (input: EventDetailsInput) => createEvent(ctx, access, input),
    getEventForAdmin: (input: { eventId: string }) =>
      getEventForAdmin(ctx, access, input),
    listEventsForAdmin: () => listEventsForAdmin(ctx, access),
    listPublishedEvents: () => listPublishedEvents(ctx, access),
    getPublicEvent: (input: { slug: string }) =>
      getPublicEvent(ctx, access, input),
  });
}

export const eventsUseCases = eventsModule(accessBeforeRoles);
