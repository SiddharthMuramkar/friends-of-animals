export const AMBASSADOR_STATUSES = ["submitted", "approved", "declined"] as const;
export type AmbassadorStatus = (typeof AMBASSADOR_STATUSES)[number];
export const AMBASSADOR_TRANSITIONS = {
  submitted: { approve: "approved", decline: "declined" },
  approved: {},
  declined: {},
} as const satisfies Record<AmbassadorStatus, Partial<Record<"approve" | "decline", AmbassadorStatus>>>;
