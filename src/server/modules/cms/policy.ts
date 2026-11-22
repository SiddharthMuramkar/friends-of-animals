// Who may run the CMS use cases (#111). Content managers with a global
// grant read drafts, save them and publish; as a staff role, theirs also
// needs the session's second factor (#60). Super admin is not a wildcard:
// a super admin who edits content grants themselves the role, which the
// audit log records (who holds it in production: HR-17). Published
// documents are public: the site's pages show them.
//
// Loads under plain Node: relative imports only.

import { role, type Policy, type Rule } from "../../access/domain/policy";

/** Allows everyone, signed in or not. */
const anyone: Rule = () => ({ allowed: true, role: null });

export const CMS_POLICY = {
  /** The document list, revisions and draft previews. */
  "cms.read_drafts": role("content_manager"),
  "cms.save_draft": role("content_manager"),
  "cms.publish": role("content_manager"),
  "cms.read_published": anyone,
  /**
   * Which organisation facts are still missing, by name: staff who enter
   * them or ask for them. The public health check only says "incomplete".
   */
  "cms.read_facts_readiness": role(
    "staff_admin",
    "super_admin",
    "content_manager"
  ),
} satisfies Policy<string>;

export type CmsAction = keyof typeof CMS_POLICY;
