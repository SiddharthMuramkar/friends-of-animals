import {
  anyOf,
  owner,
  role,
  signedIn,
  system,
  type Policy,
} from "../../access/domain/policy";

export const COMMUNITY_POLICY = {
  "community.join": signedIn,
  "community.profile.update": signedIn,
  "community.leave": signedIn,
  "community.timeline.read": signedIn,
  "community.child.read": owner,
  "community.members.list": role("community_manager", "super_admin"),
  "community.milestones.rebuild": anyOf(role("super_admin"), system("worker")),
  "community.results.record": system("worker"),
} satisfies Policy<string>;
