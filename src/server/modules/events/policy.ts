import {
  anyOf,
  owner,
  role,
  signedIn,
  system,
  type Policy,
  type Rule,
} from "../../access/domain/policy";
export const organiser = role("content_manager", "community_manager");
const publicRead: Rule = () => ({ allowed: true, role: null });
export const EVENTS_POLICY = {
  "event.admin": organiser,
  "event.public": publicRead,
  "event.register": signedIn,
  "event.my_registrations": signedIn,
  "event.registration.cancel": anyOf(organiser, owner),
  "event.check_in": organiser,
  "event.end": system("worker"),
} satisfies Policy<string>;
