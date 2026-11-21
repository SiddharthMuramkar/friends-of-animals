// Who may run the events use cases (#125). Organisers are content managers
// and community managers, both global staff roles; members and other staff
// are refused. The public list and detail are open to anyone.
//
// Each action becomes one rule in the platform policy when access control
// (#59) is in this branch: "organisers" is role("content_manager",
// "community_manager"), "anyone" is anyOf(signedOut, signedIn). Until then
// ./access.ts reads this table directly.
//
// Pure: no I/O, no "server-only", no `@/` imports.

/** The roles that run events, in the order the audit log reports them. */
export const EVENT_ORGANISER_ROLES = [
  "content_manager",
  "community_manager",
] as const;

export type EventOrganiserRole = (typeof EVENT_ORGANISER_ROLES)[number];

export const EVENTS_POLICY = {
  "event.create": "organisers",
  "event.update": "organisers",
  "event.publish": "organisers",
  "event.cancel": "organisers",
  "event.complete": "organisers",
  "event.read_admin": "organisers",
  "event.read_public": "anyone",
} as const satisfies Record<string, "organisers" | "anyone">;

export type EventsAction = keyof typeof EVENTS_POLICY;
