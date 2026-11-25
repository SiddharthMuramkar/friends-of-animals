import {
  anyOf,
  owner,
  role,
  signedIn,
  type Policy,
} from "../../access/domain/policy";
const manager = role("community_manager", "super_admin");
export const CLUBS_POLICY = {
  "club.apply": signedIn,
  "club.withdraw": owner,
  "club.decide": manager,
  "club.join": signedIn,
  "club.leave": signedIn,
  "club.view": signedIn,
  "club.review": manager,
  "club.members.read": anyOf(
    manager,
    role("institution_admin", "institution_coordinator")
  ),
} satisfies Policy<string>;
