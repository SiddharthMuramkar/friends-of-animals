// The students page's fees summary (#77): how many students still wait for
// their fee and how many are confirmed, from the registration's counts.
// "Pay fees" is offered only while some wait. Withdrawn students owe
// nothing. Pure.

export type FeeSummary =
  /** Some students wait for their fee: offer to pay it. */
  | { kind: "unpaid"; unpaid: number; confirmed: number }
  /** Every enrolled student's fee is paid. */
  | { kind: "paid"; confirmed: number }
  /** No student is enrolled yet, so there is nothing to say. */
  | { kind: "none" };

export function feeSummary(counts: {
  enrolled: number;
  confirmed: number;
  withdrawn: number;
}): FeeSummary {
  if (counts.enrolled > 0) {
    return {
      kind: "unpaid",
      unpaid: counts.enrolled,
      confirmed: counts.confirmed,
    };
  }
  if (counts.confirmed > 0)
    return { kind: "paid", confirmed: counts.confirmed };
  return { kind: "none" };
}
