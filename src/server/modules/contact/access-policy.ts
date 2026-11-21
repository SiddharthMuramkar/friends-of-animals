// Who may use the contact form and the staff inbox (#113). Anyone on the
// site may send a message. The inbox is for its teams (each a global staff
// role, ./domain/routing.ts) and the two admin roles; which messages each
// of them sees is the inbox's own check (`inboxAccess`). Pure, so the
// platform policy (src/server/access/policies.ts) can import it.

import {
  anyOf,
  role,
  signedIn,
  signedOut,
  type Policy,
} from "../../access/domain/policy";
import { CONTACT_TEAMS } from "./domain/routing";

const INBOX_ROLES = ["super_admin", ...CONTACT_TEAMS] as const;

export const CONTACT_POLICY = {
  "contact.message.submit": anyOf(signedOut, signedIn),
  "contact.inbox.view": role(...INBOX_ROLES),
  "contact.inbox.handle": role(...INBOX_ROLES),
} satisfies Policy<string>;
