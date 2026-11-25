import {
  CLUB_APPLY,
  DASHBOARD_COMMUNITY,
  DASHBOARD_VOLUNTEER,
  guardianChildPath,
  guardianChildTimelinePath,
  guardianChildVolunteerPath,
} from "../../../lib/app-routes";

export const INVITATION_ACTIONS = [
  "join_community",
  "volunteer",
  "start_club",
  "join_campaigns",
  "attend_events",
] as const;
export type InvitationAction = (typeof INVITATION_ACTIONS)[number];
export type InvitationRecipient = {
  userId: string;
  relation: "self" | "guardian";
  profileId: string;
  age: number | null;
  hasLogin: boolean;
};

// The choice is interest, not enrollment. The owning use cases enforce
// membership, age, declarations, affiliation, event capacity and check-in.
export function offeredActions(
  recipient: InvitationRecipient,
  volunteerMinAge: number
): InvitationAction[] {
  return INVITATION_ACTIONS.filter((action) => {
    if (action === "volunteer")
      return (
        recipient.age !== null &&
        recipient.age >= volunteerMinAge &&
        recipient.hasLogin
      );
    if (action === "start_club")
      return (
        recipient.age !== null && recipient.age >= 13 && recipient.hasLogin
      );
    return true;
  });
}

export function actionDestination(
  action: InvitationAction,
  recipient: InvitationRecipient
): string {
  if (action === "join_community")
    return recipient.relation === "self"
      ? DASHBOARD_COMMUNITY
      : guardianChildTimelinePath(recipient.profileId);
  if (action === "volunteer")
    return recipient.relation === "self"
      ? DASHBOARD_VOLUNTEER
      : guardianChildVolunteerPath(recipient.profileId);
  if (action === "start_club")
    return recipient.relation === "self"
      ? CLUB_APPLY
      : guardianChildPath(recipient.profileId);
  // The public listing includes campaigns and events; their registration
  // page explicitly allows an authorized guardian to select the child.
  return "/events";
}
