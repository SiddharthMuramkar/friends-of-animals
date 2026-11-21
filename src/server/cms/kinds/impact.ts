// The impact counters as a CMS document (#111): the counted values and the
// date they were counted, shown on /impact and in the home page's counters.
// Funds raised is not one of them: it is computed from the accounts on the
// transparency page, never typed in. Small counts stay hidden when shown
// (visibleCounters), whatever is published.
//
// Loads under plain Node (seed): relative imports only.

import { z } from "zod";

import { SAMPLE_IMPACT } from "../../../content/sample";
import { impactSchema } from "../../../content/sample/model";
import { defineKind, uniqueKeys } from "./fields";

const impactBodySchema = impactSchema.superRefine((impact, ctx) =>
  uniqueKeys(
    impact.counters.map((c) => c.key),
    ctx,
    ["counters"]
  )
);

export type ImpactBody = z.output<typeof impactBodySchema>;

export const impactKind = defineKind(impactBodySchema, SAMPLE_IMPACT, {
  // A broken row shows no numbers rather than made-up ones.
  fallback: () => ({ asOf: SAMPLE_IMPACT.asOf, counters: [] }),
});
