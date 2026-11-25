// Who may file and answer privacy rights requests (#115): their rules in
// the platform policy (src/server/access/policies.ts).
//
// A signed-in user files a request about their own data, or a verified
// guardian about a linked child (./submit.ts checks the link and the ages
// first). A request is read by whoever filed it and by the verified
// guardian of the child it is about; only whoever filed it cancels it or
// downloads its data export, which staff never do.
//
// Everything else is for the grievance officer alone: the queue, a
// request's page, assigning, notes, refusing and completing. No other role
// is named, super admin included (the policy has no wildcard), and the
// role is a staff role, so #60's second factor guards it too. Carrying out
// an erasure can't be undone, so it also needs a fresh second factor.
//
// Loads under plain Node (the bootstrap command reads the platform
// policy): relative imports only, no "server-only".

import {
  owner,
  role,
  signedIn,
  stepUp,
  system,
  type Policy,
  type Rule,
} from "../../../access/domain/policy";

/** The grievance officer's use cases, one action each. */
export const GRIEVANCE_OFFICER_ACTIONS = [
  "privacy_request.queue",
  "privacy_request.view",
  "privacy_request.assign",
  "privacy_request.start",
  "privacy_request.note",
  "privacy_request.reject",
  "privacy_request.complete_correction",
  "privacy_request.build_export",
  "privacy_request.preview_erasure",
] as const;

export type GrievanceOfficerAction = (typeof GRIEVANCE_OFFICER_ACTIONS)[number];

const officerOnly: Rule = role("grievance_officer");

export const PRIVACY_REQUESTS_POLICY = {
  "privacy_request.submit": signedIn,
  /** The requester, or the guardian of the child it is about. */
  "privacy_request.view_own": owner,
  /** Only whoever filed it, and only before work starts. */
  "privacy_request.cancel": owner,
  /** Only whoever filed it: staff never download a person's data. */
  "privacy_request.download_export": owner,
  ...(Object.fromEntries(
    GRIEVANCE_OFFICER_ACTIONS.map((action) => [action, officerOnly])
  ) as Record<GrievanceOfficerAction, Rule>),
  "privacy_request.execute_erasure": stepUp(officerOnly),
  /** The daily overdue digest, and the export and erasure jobs. */
  "privacy_request.run_jobs": system("worker", "cli"),
} satisfies Policy<string>;

export type PrivacyRequestsAction = keyof typeof PRIVACY_REQUESTS_POLICY;
