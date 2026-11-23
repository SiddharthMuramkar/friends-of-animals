// getFeesToPay({ institutionId, reference }) (#77): what the pay page
// shows before a coordinator pays: how many of the registration's
// students still wait for their fee, the institution fee each, and the
// total payInstitutionFees would ask the gateway for. Also the last batch
// that was paid, so the page can point to its receipt. Reads only.

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { paymentBatch } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import { getRegistrationTerms } from "../competitions/terms/read";
import { institutionResource } from "../institutions/coordinators/policy";
import { loadEnrolmentFacts } from "../registration/enrolment-facts";
import { payableRegistrations } from "./batches";

export type FeesToPay = {
  /** The institution registration, e.g. PAWS27-I-Q2W9R. */
  reference: string;
  institution: { name: string };
  competition: { code: string; name: string };
  /** Students enrolled and not yet confirmed. */
  students: number;
  /** The institution fee each; null while the competition hasn't set it. */
  fee: Money | null;
  /** `students` × `fee`; null with the fee. */
  total: Money | null;
  /** The registration's latest captured batch, for its receipt. */
  lastPaidBatchId: string | null;
};

export type GetFeesToPayInput = { institutionId: string; reference: string };

export type GetFeesToPayResult =
  | { ok: true; fees: FeesToPay }
  | InvalidInput
  | { ok: false; error: "not_found" };

const feesInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
});

export async function getFeesToPay(
  ctx: UseCaseContext,
  input: GetFeesToPayInput
): Promise<GetFeesToPayResult> {
  const parsed = feesInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  await authorize(
    ctx,
    "payments.read",
    institutionResource(parsed.data.institutionId)
  );

  const facts = await loadEnrolmentFacts(ctx.db, parsed.data, ctx.clock.now(), {
    lock: false,
  });
  if (!facts) return { ok: false, error: "not_found" };
  const registered = facts.institutionRegistration;
  const students = (await payableRegistrations(ctx.db, registered.id)).length;
  const fee =
    (await getRegistrationTerms(ctx.db, registered.competitionId))?.fees
      .institution ?? null;
  const [lastPaid] = await ctx.db
    .select({ id: paymentBatch.id })
    .from(paymentBatch)
    .where(
      and(
        eq(paymentBatch.institutionRegistrationId, registered.id),
        eq(paymentBatch.status, "captured")
      )
    )
    .orderBy(desc(paymentBatch.capturedAt))
    .limit(1);

  return {
    ok: true,
    fees: {
      reference: registered.reference,
      institution: { name: facts.institution.name },
      competition: {
        code: facts.competition.code,
        name: facts.competition.name,
      },
      students,
      fee,
      total: fee
        ? { ...fee, amountMinor: fee.amountMinor * BigInt(students) }
        : null,
      lastPaidBatchId: lastPaid?.id ?? null,
    },
  };
}
