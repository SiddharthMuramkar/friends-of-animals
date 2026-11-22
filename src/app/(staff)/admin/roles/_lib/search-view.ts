// What the roles search shows after a search: the text typed, so the field
// keeps it, and either the people found or a message, already translated.
// It lives in the search form's state only, never in the URL (href.ts).

import type { FoundUser } from "@/server/access";

export type SearchView = {
  query: string;
  /** Too short, or refused: shown under the field. */
  error?: string;
  /** Undefined before the first search that ran. */
  users?: FoundUser[];
  /** search.none, when nobody matched. */
  none?: string;
};

export const EMPTY_SEARCH: SearchView = { query: "" };
