// What a competition manager sends to change where a round's entries come
// from (#98): FOA-verified entries, or the finalists of another round. The
// values match the FOA rounds ticket's `round_entry_source` enum.
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

export const entrySourceInputSchema = z.discriminatedUnion("entrySource", [
  z.strictObject({
    roundId: z.uuid(),
    entrySource: z.literal("verified_entries"),
  }),
  z.strictObject({
    roundId: z.uuid(),
    entrySource: z.literal("round_finalists"),
    sourceRoundId: z.uuid(),
  }),
]);

export type EntrySourceInput = z.infer<typeof entrySourceInputSchema>;
