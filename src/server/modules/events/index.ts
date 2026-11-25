import type { UseCaseContext } from "../../use-cases";
import {
  registerForEvent,
  cancelEventRegistration,
  listMyEventRegistrations,
  listEventRegistrations,
  getEventPlaces,
  type RegisterInput,
  type RegistrationId,
} from "./registrations";
import { checkInAttendee, getCheckInSheet } from "./check-in";
import { settleEndedEvent } from "./end";
import {
  updateEvent,
  changeStatus,
  createEvent,
  getEventForAdmin,
  getPublicEvent,
  listEventsForAdmin,
  listPublishedEvents,
  type EventId,
} from "./admin";
import type { EventDetailsInput } from "./domain/event-details";
export const eventsUseCases = (ctx: UseCaseContext) => ({
  registerForEvent: (input: RegisterInput) => registerForEvent(ctx, input),
  cancelEventRegistration: (input: RegistrationId) =>
    cancelEventRegistration(ctx, input),
  listMyEventRegistrations: (input: { childId?: string } = {}) =>
    listMyEventRegistrations(ctx, input),
  listEventRegistrations: (input: EventId) =>
    listEventRegistrations(ctx, input),
  getEventPlaces: (input: EventId) => getEventPlaces(ctx, input),
  checkInAttendee: (input: RegistrationId) => checkInAttendee(ctx, input),
  getCheckInSheet: (input: EventId & { query?: string }) =>
    getCheckInSheet(ctx, input),
  settleEndedEvent: (input: { eventId: string; endsAt: string }) =>
    settleEndedEvent(ctx, input),
  updateEvent: (input: EventId & EventDetailsInput) => updateEvent(ctx, input),
  createEvent: (input: EventDetailsInput) => createEvent(ctx, input),
  publishEvent: (input: EventId) => changeStatus(ctx, input, "published"),
  cancelEvent: (input: EventId) => changeStatus(ctx, input, "cancelled"),
  completeEvent: (input: EventId) => changeStatus(ctx, input, "completed"),
  listEventsForAdmin: () => listEventsForAdmin(ctx),
  getEventForAdmin: (input: EventId) => getEventForAdmin(ctx, input),
  listPublishedEvents: () => listPublishedEvents(ctx),
  getPublicEvent: (input: { slug: string }) => getPublicEvent(ctx, input),
});
