import type { EventDetailsInput } from "./domain/event-details";
export function details(
  now: Date,
  overrides: Partial<EventDetailsInput> = {}
): EventDetailsInput {
  return {
    kind: "event",
    title: "Compassion workshop",
    summary: "Learn how to help animals.",
    description:
      '<p>Bring a notebook.</p><script>bad()</script><img onerror="bad()"><a href="javascript:bad()">Read</a>',
    startsAt: new Date(+now + 48 * 3600_000),
    endsAt: new Date(+now + 50 * 3600_000),
    venueName: "Community Hall",
    address: "Park Road",
    city: "Pune",
    pinCode: null,
    onlineUrl: null,
    capacity: 2,
    audience: "members",
    registrationOpensAt: null,
    registrationClosesAt: null,
    waitlistEnabled: true,
    ...overrides,
  };
}
