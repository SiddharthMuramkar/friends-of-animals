// Who a survey goes to. The use case gathers everyone linked to the
// competition (participants with confirmed registrations, the guardians of
// the minors among them, coordinators of the institutions that took part)
// with each person's own messages consent; this decides who is invited and
// as what. Minors are never asked directly: their verified guardians are.
// Each person gets one invitation, however many links they have, so a
// guardian of two children answers once.
//
// Pure: loads under plain Node, relative imports only.

export const INVITATION_ROLES = [
  "participant",
  "guardian",
  "coordinator",
] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/** Which groups the manager sends the survey to. */
export type Audiences = Record<
  "participants" | "guardians" | "coordinators",
  boolean
>;

export type InvitationCandidate =
  | {
      kind: "participant";
      /** Under 18 on the day the survey is sent. */
      minor: boolean;
      /** The participant's own account, if they have one. */
      userId: string | null;
      /** The participant's own messages consent. */
      consented: boolean;
      /** Active guardians, with each guardian's own messages consent. */
      guardians: readonly {
        userId: string;
        verified: boolean;
        consented: boolean;
      }[];
    }
  | { kind: "coordinator"; userId: string; consented: boolean };

export type InvitationPlan = {
  /** One per person, sorted by user id. */
  invitations: { userId: string; role: InvitationRole }[];
  skipped: {
    /** People linked to the competition without messages consent. */
    noConsent: number;
    /** Minors with no verified guardian to ask. */
    noGuardian: number;
    /** Adult participants with no account to send to. */
    noAccount: number;
  };
};

export function planInvitations(
  candidates: readonly InvitationCandidate[],
  audiences: Audiences
): InvitationPlan {
  const invited = new Map<string, InvitationRole>();
  const refused = new Set<string>();
  let noGuardian = 0;
  let noAccount = 0;

  const consider = (userId: string, role: InvitationRole, ok: boolean) => {
    if (!ok) {
      refused.add(userId);
      return;
    }
    const current = invited.get(userId);
    if (current === undefined || rank(role) < rank(current)) {
      invited.set(userId, role);
    }
  };

  for (const candidate of candidates) {
    if (candidate.kind === "coordinator") {
      if (audiences.coordinators) {
        consider(candidate.userId, "coordinator", candidate.consented);
      }
    } else if (!candidate.minor) {
      if (!audiences.participants) continue;
      if (candidate.userId === null) noAccount += 1;
      else consider(candidate.userId, "participant", candidate.consented);
    } else {
      if (!audiences.guardians) continue;
      const verified = candidate.guardians.filter(
        (guardian) => guardian.verified
      );
      if (verified.length === 0) noGuardian += 1;
      for (const guardian of verified) {
        consider(guardian.userId, "guardian", guardian.consented);
      }
    }
  }

  const noConsent = [...refused].filter((userId) => !invited.has(userId));
  return {
    invitations: [...invited]
      .map(([userId, role]) => ({ userId, role }))
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)),
    skipped: { noConsent: noConsent.length, noGuardian, noAccount },
  };
}

/** Lower is preferred when one person is linked in several ways. */
function rank(role: InvitationRole): number {
  return INVITATION_ROLES.indexOf(role);
}
