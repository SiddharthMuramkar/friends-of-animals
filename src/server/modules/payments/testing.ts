// Shared set-up for the payments module's Seam 1 tests: a verified school
// registered for an open competition with a fee, its coordinator, and
// students enrolled through the real use case. Test code only; nothing in
// the app imports it.

import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import type { UseCases } from "@/server/app";
import {
  auditLog,
  competitionFee,
  competitionKeyDate,
  fileAsset,
  gatewayWebhookEvent,
  offlinePayment,
  outbox,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  registration,
  type PaymentReviewCaseRow,
} from "@/server/db/schema";
import { AANYA, registeredSchool } from "@/server/modules/registration/testing";
import type { Harness } from "@/test/harness";

/** The sample institution fee: ₹500 a student, in paise. */
export const FEE_PAISE = 50_000n;

/** The guardian email of the `n`th enrolled student (from 1). */
export const guardianEmail = (n: number) => `guardian-${n}@example.test`;

/**
 * A school registered for "Paws on the Pavement" (PAWS27, or `code`) with
 * `students` students enrolled by its coordinator, each a child with a
 * guardian whose email is `guardianEmail(n)`. The institution fee is
 * `feePaise`, or not set at all when it is null.
 */
export async function schoolWithStudents(
  h: Harness,
  {
    students = 2,
    feePaise = FEE_PAISE,
    name,
    code = "PAWS27",
  }: {
    students?: number;
    feePaise?: bigint | null;
    name?: string;
    code?: string;
  } = {}
) {
  const school = await registeredSchool(h, {
    ...(name ? { name } : {}),
    competition: {
      code,
      name: code === "PAWS27" ? "Paws on the Pavement" : `Competition ${code}`,
    },
  });
  if (feePaise !== null) await setInstitutionFee(h, school, feePaise);
  const registrationIds: string[] = [];
  for (let n = 1; n <= students; n++) {
    registrationIds.push(await enrol(h, school, n));
  }
  const ids = {
    institutionId: school.institutionId,
    reference: school.reference,
  };
  return {
    ...school,
    registrationIds,
    /** The school's registration, as the payment use cases take it. */
    ids,
    /** Pays the school's fees as its coordinator, or as `actor`. */
    pay: (actor: Actor = school.coordinator.actor) =>
      h.as(actor).payInstitutionFees(ids),
  };
}

export type School = Awaited<ReturnType<typeof schoolWithStudents>>;

/** Pays the school's fees as its coordinator and returns the open order. */
export async function openOrder(school: School) {
  const result = await school.pay();
  if (!result.ok || result.kind !== "checkout") {
    throw new Error(`No order: ${JSON.stringify(result)}`);
  }
  return { batchId: result.batchId, orderId: result.checkout.orderId };
}

/** The competition's institution fee, as FOA set it (#72). */
export async function setInstitutionFee(
  h: Harness,
  school: { competition: { id: string } },
  amountMinor: bigint
): Promise<void> {
  await h.db
    .insert(competitionFee)
    .values({
      competitionId: school.competition.id,
      route: "institution",
      amountMinor,
      updatedAt: h.clock.now(),
    })
    .onConflictDoUpdate({
      target: [competitionFee.competitionId, competitionFee.route],
      set: { amountMinor },
    });
}

/** Enrols the `n`th student (from 1) as the school's coordinator. */
export async function enrol(
  h: Harness,
  school: Awaited<ReturnType<typeof registeredSchool>>,
  n: number
): Promise<string> {
  const result = await h.as(school.coordinator.actor).enrolStudent({
    institutionId: school.institutionId,
    reference: school.reference,
    student: {
      ...AANYA,
      fullName: `Student ${String.fromCharCode(64 + n)} Rao`,
      guardianEmail: guardianEmail(n),
    },
  });
  if (!result.ok) throw new Error(`Could not enrol: ${result.error}`);
  return result.registrationId;
}

/** Every row a capture or a replay may change, to compare before and after. */
export async function paymentRows(h: Harness) {
  return {
    batches: await h.db.select().from(paymentBatch).orderBy(paymentBatch.id),
    items: await h.db
      .select()
      .from(paymentBatchItem)
      .orderBy(paymentBatchItem.batchId, paymentBatchItem.registrationId),
    registrations: await h.db
      .select()
      .from(registration)
      .orderBy(registration.id),
    webhooks: await h.db
      .select()
      .from(gatewayWebhookEvent)
      .orderBy(gatewayWebhookEvent.id),
    audit: await h.db.select().from(auditLog).orderBy(asc(auditLog.id)),
    outbox: await h.db.select().from(outbox).orderBy(asc(outbox.id)),
    offlinePayments: await h.db
      .select()
      .from(offlinePayment)
      .orderBy(offlinePayment.id),
    reviewCases: await h.db
      .select()
      .from(paymentReviewCase)
      .orderBy(paymentReviewCase.id),
  };
}

/** The school's registrations, with status and number. */
export async function registrationsOf(h: Harness, ids: readonly string[]) {
  const rows = await h.db
    .select({
      id: registration.id,
      status: registration.status,
      registrationNumber: registration.registrationNumber,
    })
    .from(registration)
    .orderBy(registration.id);
  return rows.filter((row) => ids.includes(row.id));
}

/** A batch's row. */
export async function batchRow(h: Harness, batchId: string) {
  const [row] = await h.db
    .select()
    .from(paymentBatch)
    .where(eq(paymentBatch.id, batchId));
  if (!row) throw new Error(`No batch ${batchId}`);
  return row;
}

/** The roles that may record offline payments and resolve review cases. */
export type PaymentsStaffRole = "finance" | "staff_admin" | "super_admin";

/**
 * A signed-in user holding `role` globally (none for a plain member), who
 * passed their second factor on signing in, as staff do.
 */
export async function signInStaff(
  h: Harness,
  role: PaymentsStaffRole | "competition_manager" | null = "finance"
): Promise<{ actor: Actor; userId: string }> {
  const user = await h.seed.member();
  if (role) await h.seed.grant(user, { role, scope: { type: "global" } });
  return { actor: await h.signIn(user), userId: user.id };
}

/** A scanned cheque, as far as the fakes care: bytes of a declared size. */
export const CHEQUE_SCAN = new Uint8Array(2048).fill(3);

/**
 * Uploads a cheque scan as `actor` for batch `batchId`, as finance's browser
 * does, and returns its file id. The file is `uploaded` (awaiting its
 * scan) unless `status` says where the scan got to.
 */
export async function uploadProof(
  h: Harness,
  actor: Actor,
  batchId: string,
  status?: "clean" | "scanning" | "quarantined"
): Promise<string> {
  const requested = await h.as(actor).requestOfflinePaymentProofUpload({
    batchId,
    contentType: "application/pdf",
    sizeBytes: CHEQUE_SCAN.length,
  });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  const stored = await h.storage.put(
    requested.uploadUrl,
    CHEQUE_SCAN,
    requested.headers
  );
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  const completed = await h
    .as(actor)
    .completeUpload({ fileId: requested.fileId });
  if (!completed.ok) throw new Error(JSON.stringify(completed));
  if (status) {
    // Stands in for the scanner (docs/agents/seam-1.md).
    await h.db
      .update(fileAsset)
      .set({ status })
      .where(eq(fileAsset.id, requested.fileId));
  }
  return requested.fileId;
}

/** A batch's offline payment row, if any. */
export async function offlinePaymentOf(h: Harness, batchId: string) {
  const [row] = await h.db
    .select()
    .from(offlinePayment)
    .where(eq(offlinePayment.batchId, batchId));
  return row ?? null;
}

/** A batch's review cases, oldest first. */
export async function reviewCasesOf(h: Harness, batchId: string) {
  return h.db
    .select()
    .from(paymentReviewCase)
    .where(eq(paymentReviewCase.batchId, batchId))
    .orderBy(asc(paymentReviewCase.openedAt), asc(paymentReviewCase.id));
}

/** Recreates receipt data that could be confirmed before the INR guard. */
export async function confirmReviewedReceipt(
  h: Harness,
  staff: Pick<UseCases, "resolvePaymentReviewCase">,
  receipt: Pick<PaymentReviewCaseRow, "id" | "currency">,
  reason: string
) {
  const confirm = () =>
    staff.resolvePaymentReviewCase({
      caseId: receipt.id,
      outcome: "confirm",
      reason,
    });
  if (receipt.currency === "INR") return confirm();

  const setCurrency = (currency: string) =>
    h.db
      .update(paymentReviewCase)
      .set({ currency })
      .where(eq(paymentReviewCase.id, receipt.id));
  await setCurrency("INR");
  try {
    return await confirm();
  } finally {
    await setCurrency(receipt.currency);
  }
}

/**
 * Moves the school's competition's registration close to a minute ago, as
 * if the clock had passed it (advancing the clock 55 days would end every
 * session).
 */
export async function closeRegistration(
  h: Harness,
  school: { competition: { id: string } }
): Promise<void> {
  await h.db
    .update(competitionKeyDate)
    .set({ at: new Date(h.clock.now().getTime() - 60_000) })
    .where(
      and(
        eq(competitionKeyDate.competitionId, school.competition.id),
        eq(competitionKeyDate.kind, "registration_closes")
      )
    );
}
