import {
  role,
  signedIn,
  stepUp,
  system,
  type Policy,
} from "../../access/domain/policy";

export const INVITATIONS_POLICY = {
  "competition_invitation.publish": system("worker"),
  "competition_invitation.backfill": stepUp(role("super_admin")),
  "competition_invitation.read": signedIn,
  "competition_invitation.accept": signedIn,
} satisfies Policy<string>;
