// Contact topics, the team each one is routed to, and which teams' messages
// a member of staff sees (#113). A team is a global staff role (#59), so
// granting someone `finance` puts them on the donations team; there is no
// separate team table. The team is stored on each message when it arrives,
// so changing the routing never moves messages already in the inbox.
//
// Loads under plain Node (schema, seed script), so no "server-only" here.

/** The contact page's topics, in its order. Safeguarding is never one. */
export const CONTACT_TOPICS = [
  "GENERAL",
  "SCHOOLS",
  "NGOS",
  "ADOPTION",
  "VOLUNTEERING",
  "DONATIONS",
  "MEDIA",
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** The staff roles a message can be routed to (each is a #59 role). */
export const CONTACT_TEAMS = [
  "staff_admin",
  "competition_manager",
  "community_manager",
  "adoption_coordinator",
  "finance",
  "content_manager",
] as const;

export type ContactTeam = (typeof CONTACT_TEAMS)[number];

export type ContactRouting = Readonly<Record<ContactTopic, ContactTeam>>;

/** Defaults until FOA confirms the routing. */
export const DEFAULT_CONTACT_ROUTING: ContactRouting = {
  GENERAL: "staff_admin",
  SCHOOLS: "competition_manager",
  NGOS: "community_manager",
  ADOPTION: "adoption_coordinator",
  VOLUNTEERING: "community_manager",
  DONATIONS: "finance",
  MEDIA: "content_manager",
};

/** The team a new message on `topic` goes to. */
export function teamForTopic(
  topic: ContactTopic,
  routing: ContactRouting = DEFAULT_CONTACT_ROUTING
): ContactTeam {
  return routing[topic];
}

/** Roles that see every team's messages. */
const SEES_ALL: ReadonlySet<string> = new Set(["staff_admin", "super_admin"]);

const TEAMS: ReadonlySet<string> = new Set(CONTACT_TEAMS);

function isContactTeam(role: string): role is ContactTeam {
  return TEAMS.has(role);
}

/** One #59 grant, as far as the inbox cares. */
export type GrantLike = {
  role: string;
  scope: { type: string };
};

export type InboxAccess =
  | { kind: "all" }
  | { kind: "teams"; teams: ContactTeam[] }
  | { kind: "none" };

/**
 * Which messages the holder of `grants` sees and handles. Teams are global
 * roles, so only global grants count: an adoption coordinator for one
 * organisation is not on the adoption team.
 */
export function inboxAccess(grants: readonly GrantLike[]): InboxAccess {
  const roles = grants
    .filter((grant) => grant.scope.type === "global")
    .map((grant) => grant.role);
  if (roles.some((role) => SEES_ALL.has(role))) return { kind: "all" };
  const teams = [...new Set(roles.filter(isContactTeam))];
  return teams.length > 0 ? { kind: "teams", teams } : { kind: "none" };
}

/** Whether `access` covers messages routed to `team`. */
export function mayHandle(access: InboxAccess, team: ContactTeam): boolean {
  if (access.kind === "all") return true;
  return access.kind === "teams" && access.teams.includes(team);
}
