import { z } from "zod";
import { invalidInput } from "../../../input";
import { istDateRange } from "../../ledger/domain/period";

const periodInput = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => istDateRange({ from, to }).ok, {
    path: ["to"],
    message: "invalid_date_range",
  });
export type ObjectivePeriodInput = z.input<typeof periodInput>;
export type Period = ObjectivePeriodInput & { start: Date; end: Date };

export function resolvePeriod(input: ObjectivePeriodInput) {
  const parsed = periodInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { from, to } = parsed.data;
  const range = istDateRange({ from, to });
  if (!range.ok || !range.fromInclusive || !range.toExclusive)
    throw Error("Invalid validated period");
  return {
    ok: true,
    period: { from, to, start: range.fromInclusive, end: range.toExclusive },
  } as const;
}
