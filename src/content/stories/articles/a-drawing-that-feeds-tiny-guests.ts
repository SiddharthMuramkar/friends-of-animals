import type { ArticleBody } from "../model";

// Placeholder body so builds pass: the stories task replaces this file with
// the full, cited article (research/stories.md §4).
export const article = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "The full article is being written and checked against its sources.",
      ],
    },
  ],
  footnotes: [],
} satisfies ArticleBody;
