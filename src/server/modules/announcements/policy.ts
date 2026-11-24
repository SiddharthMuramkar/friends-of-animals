// Who may do what with announcements (#84): competition managers write,
// preview and send them, for the competitions their grant covers (one
// competition, or all of them for a global grant).
//
// Loads under plain Node: relative imports only.

import { role, type Policy } from "../../access/domain/policy";

export const ANNOUNCEMENTS_POLICY = {
  /** Create, edit, read, list, preview and send. */
  "announcement.manage": role("competition_manager"),
} satisfies Policy<string>;

export type AnnouncementsAction = keyof typeof ANNOUNCEMENTS_POLICY;
