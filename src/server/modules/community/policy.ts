import {
  anyOf,
  owner,
  role,
  signedIn,
  system,
  type Policy,
} from "../../access/domain/policy";

export const COMMUNITY_POLICY = {
  "ambassador.read": signedIn,
  "ambassador.apply": signedIn,
  "ambassador.review": role("community_manager", "super_admin"),
  "ambassador.decide": role("community_manager", "super_admin"),
  "community.join": signedIn,
  "community.profile.update": signedIn,
  "community.leave": signedIn,
  "community.timeline.read": signedIn,
  "community.child.read": owner,
  "community.members.list": role("community_manager", "super_admin"),
  "community.milestones.rebuild": anyOf(role("super_admin"), system("worker")),
  "community.results.record": system("worker"),
} satisfies Policy<string>;
