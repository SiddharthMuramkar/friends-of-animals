// getPaymentBatch({ institutionId, batchId }) (#77): one batch as its
// institution's coordinators see it: what it charges, its status, the
// students it paid (or pays) for with their registration numbers once
// confirmed, and, while it waits for payment, the checkout to open again.
// A batch of another institution is not found.

import { and, asc, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { z } from "zod";

import registrationMessages from "../../../../messages/en-IN/registration.json";
import { authorize } from "../../access/can";
import {
  competition,
  institutionRegistration,
  participantProfile,
  paymentBatch,
  paymentBatchItem,
  registration,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { CheckoutParams, Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import type { RegistrationStatus } from "../registration/domain/registration-status";
import type { PaymentBatchStatus } from "./domain/batch-status";

export type PaymentBatchItemView = {
  registrationId: string;
  fullName: string;
  amountMinor: bigint;
  status: RegistrationStatus;
  registrationNumber: string | null;
};

export type PaymentBatchView = {
  id: string;
  status: PaymentBatchStatus;
  amount: Money;
  /** The institution registration it pays for, e.g. PAWS27-I-Q2W9R. */
  reference: string;
  competition: { code: string; name: string };
  createdAt: Date;
  capturedAt: Date | null;
  /** By student name. */
  items: PaymentBatchItemView[];
  /** What the browser opens to pay, while the batch waits for payment. */
  checkout: CheckoutParams | null;
};

export type GetPaymentBatchResult =
  | { ok: true; batch: PaymentBatchView }
  | InvalidInput
  | { ok: false; error: "not_found" };

const getInput = z.object({ institutionId: z.uuid(), batchId: z.uuid() });

const t = createTranslator({
  locale: "en-IN",
  messages: registrationMessages,
  namespace: "registration.payment",
});

const byName = new Intl.Collator("en-IN", { sensitivity: "base" });

export async function getPaymentBatch(
  ctx: UseCaseContext,
  input: { institutionId: string; batchId: string }
): Promise<GetPaymentBatchResult> {
  const parsed = getInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, batchId } = parsed.data;
  await authorize(ctx, "payments.read", institutionResource(institutionId));

  const [batch] = await ctx.db
    .select({
      id: paymentBatch.id,
      status: paymentBatch.status,
      amountMinor: paymentBatch.amountMinor,
      gateway: paymentBatch.gateway,
      orderId: paymentBatch.gatewayOrderId,
      createdAt: paymentBatch.createdAt,
      capturedAt: paymentBatch.capturedAt,
      reference: institutionRegistration.reference,
      competitionCode: competition.code,
      competitionName: competition.name,
    })
    .from(paymentBatch)
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, paymentBatch.institutionRegistrationId)
    )
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .where(
      and(
        eq(paymentBatch.id, batchId),
        eq(paymentBatch.institutionId, institutionId)
      )
    );
  if (!batch) return { ok: false, error: "not_found" };

  const items = (
    await ctx.db
      .select({
        registrationId: paymentBatchItem.registrationId,
        fullName: participantProfile.fullName,
        amountMinor: paymentBatchItem.amountMinor,
        status: registration.status,
        registrationNumber: registration.registrationNumber,
      })
      .from(paymentBatchItem)
      .innerJoin(
        registration,
        eq(registration.id, paymentBatchItem.registrationId)
      )
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .where(eq(paymentBatchItem.batchId, batchId))
      .orderBy(asc(paymentBatchItem.registrationId))
  ).toSorted((a, b) => byName.compare(a.fullName, b.fullName));

  const amount: Money = { amountMinor: batch.amountMinor, currency: "INR" };
  const payable =
    batch.status === "order_created" &&
    batch.orderId !== null &&
    batch.gateway === ctx.payments.name;
  return {
    ok: true,
    batch: {
      id: batch.id,
      status: batch.status,
      amount,
      reference: batch.reference,
      competition: { code: batch.competitionCode, name: batch.competitionName },
      createdAt: batch.createdAt,
      capturedAt: batch.capturedAt,
      items,
      checkout: payable
        ? ctx.payments.checkout({
            orderId: batch.orderId!,
            amount,
            description: t("checkoutDescription", {
              count: items.length,
              competition: batch.competitionName,
              reference: batch.reference,
            }),
          })
        : null,
    },
  };
}
