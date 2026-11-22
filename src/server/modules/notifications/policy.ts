// Who may run the notifications use cases (#69). Templates are content
// managers' work; super admin is not a wildcard, so the rule names it too.
// Staff admins are refused. A user's inbox and channel choices are their
// own: the use cases only ever touch the actor's rows. Loads under plain
// Node: relative imports only.

import { role, signedIn, type Policy } from "../../access/domain/policy";

export const NOTIFICATIONS_POLICY = {
  "message_template.view": role("content_manager", "super_admin"),
  "message_template.edit": role("content_manager", "super_admin"),
  "inbox.view": signedIn,
  "inbox.mark_read": signedIn,
  "notification_preference.view": signedIn,
  "notification_preference.edit": signedIn,
} satisfies Policy<string>;

export type NotificationsAction = keyof typeof NOTIFICATIONS_POLICY;
