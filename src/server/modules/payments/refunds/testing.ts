// Shared set-up for the refunds Seam 1 tests (#80): batches captured
// through the fake gateway's webhook or paid by cheque, the people who ask
// for and decide refunds, and the rows a test asserts on. Test code only;
// nothing in the app imports it.

import { asc, eq, like } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  outbox,
  refund,
  refundItem,
  registration,
} from "@/server/db/schema";
import type { Harness } from "@/test/harness";

import {
  openOrder,
  schoolWithStudents,
  signInStaff,
  uploadProof,
  type School,
} from "../testing";

export { FEE_PAISE } from "../testing";

/** A refund request's reason, as a competition manager would write it. */
export const REASON = "The school closed for floods; FOA agreed to refund.";

/**
 * A school of `students` whose fees the gateway captured: its order paid in
 * full and the webhook received, so every student is confirmed.
 */
export async function capturedBatch(
  h: Harness,
  {
    students = 2,
    code = "PAWS27",
    name,
  }: { students?: number; code?: string; name?: string } = {}
) {
  const school = await schoolWithStudents(h, {
    students,
    code,
    ...(name ? { name } : {}),
  });
  const { batchId, orderId } = await openOrder(school);
  const { paymentId } = h.gateway.capture(orderId);
  const received = await h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );
  if (!received.ok || received.outcome !== "captured") {
    throw new Error(`Not captured: ${JSON.stringify(received)}`);
  }
  return {
    school,
    batchId,
    orderId,
    paymentId,
    registrationIds: school.registrationIds,
  };
}

export type CapturedBatch = Awaited<ReturnType<typeof capturedBatch>>;

/** A school of `students` whose fees finance recorded as paid by cheque. */
export async function chequePaidBatch(
  h: Harness,
  { students = 2 }: { students?: number } = {}
) {
  const school = await schoolWithStudents(h, { students });
  const { batchId } = await openOrder(school);
  const finance = await signInStaff(h, "finance");
  const proofFileId = await uploadProof(h, finance.actor, batchId, "clean");
  const recorded = await h.as(finance.actor).recordOfflinePayment({
    batchId,
    method: "cheque",
    reference: "004512",
    amount: String(500 * students),
    receivedOn: "2027-01-15",
    proofFileId,
  });
  if (!recorded.ok) throw new Error(JSON.stringify(recorded));
  return { school, batchId, registrationIds: school.registrationIds };
}

/**
 * A signed-in competition manager for the school's competition only (or,
 * with `global`, every competition), past the staff second factor.
 */
export async function signInManager(
  h: Harness,
  school: Pick<School, "competition"> | "global"
): Promise<{ actor: Actor; userId: string }> {
  const user = await h.seed.member();
  await h.seed.grant(user, {
    role: "competition_manager",
    scope:
      school === "global"
        ? { type: "global" }
        : { type: "competition", id: school.competition.id },
  });
  return { actor: await h.signIn(user), userId: user.id };
}

/** A refund's row. */
export async function refundRow(h: Harness, refundId: string) {
  const [row] = await h.db.select().from(refund).where(eq(refund.id, refundId));
  if (!row) throw new Error(`No refund ${refundId}`);
  return row;
}

/** A refund's items, by registration. */
export async function refundItemsOf(h: Harness, refundId: string) {
  return h.db
    .select()
    .from(refundItem)
    .where(eq(refundItem.refundId, refundId))
    .orderBy(asc(refundItem.registrationId));
}

/** Every refund.* audit entry, oldest first. */
export async function refundAudit(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, "refund.%"))
    .orderBy(asc(auditLog.id));
}

/** The statuses of `ids`, in id order. */
export async function statusesOf(h: Harness, ids: readonly string[]) {
  const rows = await h.db
    .select({ id: registration.id, status: registration.status })
    .from(registration)
    .orderBy(asc(registration.id));
  return rows.filter((row) => ids.includes(row.id)).map((row) => row.status);
}

/** Every row a refund signal may change, to compare before and after. */
export async function refundRows(h: Harness) {
  return {
    refunds: await h.db.select().from(refund).orderBy(refund.id),
    items: await h.db
      .select()
      .from(refundItem)
      .orderBy(refundItem.refundId, refundItem.registrationId),
    registrations: await h.db
      .select()
      .from(registration)
      .orderBy(registration.id),
    audit: await h.db.select().from(auditLog).orderBy(asc(auditLog.id)),
    outbox: await h.db.select().from(outbox).orderBy(asc(outbox.id)),
  };
}
