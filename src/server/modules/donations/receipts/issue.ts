// Issuing a donation's receipt (#106), in the capture transaction.
//
// Numbers are gapless per Indian financial year: the year's counter row in
// `receipt_sequence` is created if missing, then incremented with
// `UPDATE ... RETURNING`, which holds its row lock until the capture
// commits. A capture that rolls back gives its number back; two captures at
// once queue on the row and take consecutive numbers. (A Postgres sequence
// per year would burn numbers on rollback; max(seq)+1 races.)
//
// Every printed field is frozen into the receipt's snapshot now: the
// organisation's facts as they stand (runtime settings and the published
// site facts), the donor as they gave, the amount and the payment.
//
// Not a use case: the capture path calls it with the donation locked.
// Loads under plain Node: relative imports only.

import { eq, sql } from "drizzle-orm";

import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import { donor, receipt, receiptSequence } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { orgFactsFrom } from "../../cms/domain/org-facts";
import { revisionBodyOf } from "../../cms/repository";
import { readSetting } from "../../settings/read";
import { SITE } from "../../../../lib/site";
import { financialYearOf, formatReceiptNumber } from "../domain/receipt-number";
import { DONOR_PURPOSE, donorContact } from "../donors";
import { maskPan } from "../domain/pan";
import {
  buildReceiptSnapshot,
  receiptOrgFacts,
  RECEIPT_TEMPLATE_VERSION,
  type ReceiptSnapshot,
} from "./snapshot";

/** The next receipt number of financial year `fy`, locked until commit. */
export async function nextReceiptSequence(
  tx: AppDb,
  fy: string
): Promise<number> {
  await tx
    .insert(receiptSequence)
    .values({ fy, lastSeq: 0 })
    .onConflictDoNothing({ target: receiptSequence.fy });
  const [row] = await tx
    .update(receiptSequence)
    .set({ lastSeq: sql`${receiptSequence.lastSeq} + 1` })
    .where(eq(receiptSequence.fy, fy))
    .returning({ seq: receiptSequence.lastSeq });
  if (!row) throw new Error(`No receipt counter for ${fy}`);
  return row.seq;
}

/** The organisation's facts a receipt issued now prints. */
async function currentOrgFacts(tx: AppDb) {
  const [legalName, registrationType, registrationNumber, pan, siteFacts] =
    await Promise.all([
      readSetting(tx, "org.legalName"),
      readSetting(tx, "org.registrationType"),
      readSetting(tx, "org.registrationNumber"),
      readSetting(tx, "org.pan"),
      revisionBodyOf(tx, "site_facts", "published"),
    ]);
  return receiptOrgFacts(
    SITE.name,
    orgFactsFrom(
      { legalName, registrationType, registrationNumber, pan },
      siteFacts ? { body: siteFacts.body } : null
    )
  );
}

/** Numbers and writes the receipt of a donation captured at `issuedAt`. */
export async function issueReceipt(
  tx: AppDb,
  deps: { cipher: FieldCipher },
  input: {
    donationId: string;
    donorId: string;
    amountMinor: bigint;
    issuedAt: Date;
  } & ({ gatewayPaymentId: string } | { payment: ReceiptSnapshot["payment"] })
): Promise<{ id: string; number: string }> {
  const [giver] = await tx
    .select({
      type: donor.type,
      name: donor.name,
      email: donor.email,
      pan: donor.pan,
      organisationName: donor.organisationName,
    })
    .from(donor)
    .where(eq(donor.id, input.donorId));
  if (!giver) throw new Error(`Donation ${input.donationId} has no donor`);
  const fy = financialYearOf(input.issuedAt).token;
  // Read before taking the counter's lock, which then waits on no reads.
  const [org, has80G] = await Promise.all([
    currentOrgFacts(tx),
    readSetting(tx, "org.has80G"),
  ]);
  // A donation started with 80G off may be captured after it was turned on.
  // Without a PAN captured for that donor we must not claim deductibility.
  const taxExemption =
    has80G && giver.pan
      ? {
          scheme: "80G" as const,
          donorPanMasked: maskPan(
            deps.cipher.decrypt(DONOR_PURPOSE.pan, giver.pan)
          ),
        }
      : null;
  const seq = await nextReceiptSequence(tx, fy);
  const number = formatReceiptNumber(fy, seq);
  const id = uuidv7(input.issuedAt);
  await tx.insert(receipt).values({
    id,
    donationId: input.donationId,
    fy,
    seq,
    number,
    issuedAt: input.issuedAt,
    snapshot: buildReceiptSnapshot({
      number,
      fy,
      issuedAt: input.issuedAt,
      org,
      donor: {
        type: giver.type,
        name: donorContact(deps.cipher, giver).name,
        organisationName: giver.organisationName,
      },
      amountMinor: input.amountMinor,
      taxExemption,
      payment:
        "payment" in input
          ? input.payment
          : { mode: "online", reference: input.gatewayPaymentId },
    }),
    templateVersion: RECEIPT_TEMPLATE_VERSION,
  });
  return { id, number };
}
