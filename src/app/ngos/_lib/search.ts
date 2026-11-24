import "server-only";

import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { as } from "@/server/app";
import type {
  SearchListingsInput,
  SearchListingsResult,
} from "@/server/modules/directory";

/**
 * The directory search's read (#128), as the public: per request, never
 * cached, because the query string is the visitor's own (a pin code or a
 * rough location).
 */
export function searchDirectory(
  input: SearchListingsInput
): Promise<SearchListingsResult> {
  return as(PUBLIC_READER).searchListings(input);
}
