// Cache tags for the public adoption pages (#129). A Server Action that
// changes what the public sees of an animal refreshes `all` (browse) and
// the animal's own tag with updateTag(). The pages also carry each
// directory listing's tag (DIRECTORY_TAGS.listing), so suspending or
// withdrawing the organisation (#127) refreshes its animals too. Loads
// anywhere.

export const ADOPTION_TAGS = {
  /** Every browse page of /adopt. */
  all: "adoption",
  /** One animal's page, by its slug. */
  animal: (slug: string) => `adoption:${slug}`,
  /** /adopt/stories (#130): publishing or withdrawing a story refreshes it. */
  stories: "adoption-stories",
} as const;
