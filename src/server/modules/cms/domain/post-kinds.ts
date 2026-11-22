// What a post is and who it is for. A blog post is news from FOA; a story
// is a cited article like the five already published. Whether the public
// site shows the two apart, and with bylines, is still FOA's call (HR-51),
// so every post carries a kind and an optional author name.
//
// Pure, with no imports: the schema builds its pg enums from these lists.

/** Build the `post_kind` pg enum from this list so the two can't drift. */
export const POST_KINDS = ["blog", "story"] as const;

export type PostKind = (typeof POST_KINDS)[number];

/** The published stories' audiences (src/content/stories), unchanged. */
export const POST_AUDIENCES = ["kids", "families", "everyone"] as const;

export type PostAudience = (typeof POST_AUDIENCES)[number];
