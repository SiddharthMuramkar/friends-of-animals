// Who may take each adoption application action. The FOA adoption
// coordinator moves applications and publishes stories; the applicant
// applies, follows, withdraws and tells the story; a representative of the
// organisation that listed the animal only reads its applications; anyone
// reads published stories.
//
// Each rule lists who it allows; any one of them is enough. Coordinators
// and representatives count only at a scope covering the target: global,
// or the directory listing (organisation) that owns the animal. #59's
// policy turns each list into a rule with its combinators: "anyone" is
// anyOf(signedOut, signedIn), "signed_in" is signedIn, "owner" is owner,
// a role is role(...), several are anyOf(...). #60 adds the staff second
// factor to the coordinator rules there.
//
// Pure: loads under plain Node.

export const ADOPTION_APPLICATION_ACTIONS = [
  /** Apply for a published animal. */
  "adoption.apply",
  /** See one's own applications; queries return only the actor's. */
  "adoption.read_own",
  /** Withdraw one's own open application. */
  "adoption.withdraw",
  /** See the coordinator's queue and an application in full; start a review. */
  "adoption.review",
  /** Put the applicant in touch with the organisation (shares contact). */
  "adoption.contact",
  /** Record adopted, not matched or declined. */
  "adoption.decide",
  /** A listing's representatives read its applications. */
  "adoption.owner.read",
  /** The adopter writes a success story and consents to it. */
  "adoption.story.submit",
  "adoption.story.publish",
  "adoption.story.withdraw",
  /** The public stories page. */
  "adoption.stories.read",
] as const;

export type AdoptionApplicationAction =
  (typeof ADOPTION_APPLICATION_ACTIONS)[number];

/** A role from #59's catalogue that adoption rules name. */
export type AdoptionRole = "adoption_coordinator" | "organisation_representative";

export type AdoptionRuleTerm = "anyone" | "signed_in" | "owner" | AdoptionRole;

export const ADOPTION_APPLICATION_RULES = {
  "adoption.apply": ["signed_in"],
  "adoption.read_own": ["signed_in"],
  "adoption.withdraw": ["owner"],
  "adoption.review": ["adoption_coordinator"],
  "adoption.contact": ["adoption_coordinator"],
  "adoption.decide": ["adoption_coordinator"],
  "adoption.owner.read": ["organisation_representative"],
  "adoption.story.submit": ["owner"],
  "adoption.story.publish": ["adoption_coordinator"],
  "adoption.story.withdraw": ["owner", "adoption_coordinator"],
  "adoption.stories.read": ["anyone"],
} as const satisfies Record<
  AdoptionApplicationAction,
  readonly AdoptionRuleTerm[]
>;
