// Who hears about a participant. Messages about a minor go to the minor's
// guardians, so that FOA doesn't contact children directly; a teen with an
// own login gets an in-app copy, never an email or SMS of their own. An
// adult hears about themselves.
//
// Pure: the notifications module's `guardian_of_participant` audience loads
// the profile and its guardian links and passes them in.

export type AudienceSubject = {
  /** Under 18 at the time of the message. */
  minor: boolean;
  /** The participant's own login: an adult's, or a linked teen's. */
  loginUserId: string | null;
  /** Everyone linked to the participant as a guardian, active or not. */
  guardians: readonly { userId: string; verified: boolean; revoked: boolean }[];
};

export type Recipient = {
  userId: string;
  /** "in_app_only" keeps a minor's copy off email and SMS. */
  channels: "all" | "in_app_only";
};

export type Audience =
  | { kind: "deliver"; recipients: Recipient[] }
  /** Nobody may receive it: the caller records it as suppressed. */
  | { kind: "suppress"; reason: "no_guardian" | "no_login" };

/**
 * The recipients of a message about `subject`. Only verified, unrevoked
 * guardians count, each once, in link order; a minor with none is not
 * messaged at all, so a teen never becomes the only person told.
 */
export function minorAudience(subject: AudienceSubject): Audience {
  if (!subject.minor) {
    return subject.loginUserId
      ? {
          kind: "deliver",
          recipients: [{ userId: subject.loginUserId, channels: "all" }],
        }
      : { kind: "suppress", reason: "no_login" };
  }
  const guardianIds = new Set(
    subject.guardians
      .filter((guardian) => guardian.verified && !guardian.revoked)
      .map((guardian) => guardian.userId)
  );
  if (guardianIds.size === 0)
    return { kind: "suppress", reason: "no_guardian" };
  const recipients: Recipient[] = [...guardianIds].map((userId) => ({
    userId,
    channels: "all",
  }));
  if (subject.loginUserId && !guardianIds.has(subject.loginUserId)) {
    recipients.push({ userId: subject.loginUserId, channels: "in_app_only" });
  }
  return { kind: "deliver", recipients };
}
