// startDonation(input) (#106): someone on the donate page gives once, in
// INR. It writes the donor, a pending donation and its payment batch of
// purpose `donation` (../payments/purposes.ts), and hands back the
// donation's checkout token: the bearer that opens its checkout and
// thank-you pages, so a guest needs no account. Nothing goes to the
// gateway yet: the checkout page opens the order (./checkout.ts).
//
// - Off while the `donations.enabled` setting is off (production until
//   HR-15 and HR-47): `donations_closed`, nothing written.
// - Adults only (#55): a signed-in account known to be a minor's is
//   refused with `minor_must_ask_guardian`, nothing written. Everyone
//   declares being an adult and giving their own Indian-source money.
// - A guest may give while `donations.allowGuest`.
// - The amount is whole paise within the settings' rupee bounds.
// - A company or CSR partner names itself and says whether its name may be
//   shown in public; its receipt always carries it.
// - On the donor wall, the donor's own wall name, or by default a person's
//   first name and last initial; an organisation that keeps its name
//   private shows none.

import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { createLinkToken } from "../../crypto/link-token";
import { donation, donor, paymentBatch } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { normaliseEmailAddress } from "../../ports/email";
import type { UseCaseContext } from "../../use-cases";
import { initialDonationStatus } from "./domain/donation-status";
import {
  defaultWallName,
  DONOR_TYPES,
  givesAsOrganisation,
} from "./domain/donor";
import { DONOR_PURPOSE, donorEmailHash } from "./donors";
import { isKnownMinor } from "./minor";

export type StartDonationInput = {
  amountMinor: bigint;
  donorType: string;
  /** A person's name, or an organisation's contact person. */
  name: string;
  email: string;
  organisationName?: string;
  /** Required for a company or CSR partner: may its name be shown? */
  discloseOrganisation?: boolean;
  showOnWall: boolean;
  wallName?: string;
  declaredAdult: boolean;
  declaredIndianSource: boolean;
};

export type DonationRefusal =
  | "donations_closed"
  | "minor_must_ask_guardian"
  | "guests_not_allowed"
  | "declaration_required"
  | "disclosure_required";

export type StartDonationResult =
  | { ok: true; donationId: string; checkoutToken: string }
  | InvalidInput
  | { ok: false; error: DonationRefusal }
  | {
      ok: false;
      error: "amount_out_of_range";
      minAmountMinor: bigint;
      maxAmountMinor: bigint;
    };

/** The longest wall name a donor may choose. */
export const WALL_NAME_MAX_LENGTH = 60;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const startInput = z.strictObject({
  amountMinor: z.bigint().positive(),
  donorType: z.enum(DONOR_TYPES),
  name: text(100),
  email: z.email().max(254),
  organisationName: optionalText(120),
  discloseOrganisation: z.boolean().optional(),
  showOnWall: z.boolean(),
  wallName: optionalText(WALL_NAME_MAX_LENGTH),
  declaredAdult: z.boolean(),
  declaredIndianSource: z.boolean(),
});

export async function startDonation(
  ctx: UseCaseContext,
  input: StartDonationInput
): Promise<StartDonationResult> {
  const { role } = await authorize(ctx, "donation.start");
  if (!(await ctx.settings.get("donations.enabled"))) {
    return { ok: false, error: "donations_closed" };
  }
  const now = ctx.clock.now();
  const { actor } = ctx;
  if (actor.kind === "user") {
    if (await isKnownMinor(ctx.db, ctx.cipher, actor.userId, now)) {
      return { ok: false, error: "minor_must_ask_guardian" };
    }
  } else if (!(await ctx.settings.get("donations.allowGuest"))) {
    return { ok: false, error: "guests_not_allowed" };
  }

  const parsed = startInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const given = parsed.data;
  const organisation = givesAsOrganisation(given.donorType);
  if (organisation && !given.organisationName) {
    return { ok: false, error: "invalid_input", fields: ["organisationName"] };
  }
  if (organisation && given.discloseOrganisation === undefined) {
    return { ok: false, error: "disclosure_required" };
  }
  if (!given.declaredAdult || !given.declaredIndianSource) {
    return { ok: false, error: "declaration_required" };
  }
  const [minRupees, maxRupees] = await Promise.all([
    ctx.settings.get("donations.minAmountRupees"),
    ctx.settings.get("donations.maxAmountRupees"),
  ]);
  const minAmountMinor = BigInt(minRupees) * 100n;
  const maxAmountMinor = BigInt(Math.max(minRupees, maxRupees)) * 100n;
  if (
    given.amountMinor < minAmountMinor ||
    given.amountMinor > maxAmountMinor
  ) {
    return {
      ok: false,
      error: "amount_out_of_range",
      minAmountMinor,
      maxAmountMinor,
    };
  }

  const organisationName = organisation ? given.organisationName! : null;
  const discloseOrganisation = organisation && given.discloseOrganisation!;
  const wallName = given.showOnWall
    ? (given.wallName ??
      defaultWallName({
        type: given.donorType,
        name: given.name,
        organisationName: organisationName ?? undefined,
        discloseOrganisation,
      }))
    : null;
  const expiryHours = await ctx.settings.get("donations.pendingExpiryHours");
  const checkout = createLinkToken();
  const donorId = uuidv7(now);
  const batchId = uuidv7(now);
  const donationId = uuidv7(now);
  const email = normaliseEmailAddress(given.email);
  const payerUserId = actor.kind === "user" ? actor.userId : null;

  await ctx.db.transaction(async (tx) => {
    await tx.insert(donor).values({
      id: donorId,
      userId: payerUserId,
      type: given.donorType,
      name: ctx.cipher.encrypt(DONOR_PURPOSE.name, given.name),
      email: ctx.cipher.encrypt(DONOR_PURPOSE.email, email),
      emailHash: donorEmailHash(ctx.blindIndex, email),
      organisationName,
      discloseOrganisation,
      createdAt: now,
    });
    await tx.insert(paymentBatch).values({
      id: batchId,
      purpose: "donation",
      route: null,
      competitionId: null,
      institutionId: null,
      institutionRegistrationId: null,
      payerUserId,
      status: "created",
      amountMinor: given.amountMinor,
      currency: "INR",
      gateway: ctx.payments.name,
      createdAt: now,
      updatedAt: now,
    });
    const status = initialDonationStatus("online_checkout");
    await tx.insert(donation).values({
      id: donationId,
      donorId,
      origin: "online_checkout",
      status,
      amountMinor: given.amountMinor,
      currency: "INR",
      showOnWall: given.showOnWall,
      wallName,
      declaredAdult: true,
      declaredIndianSource: true,
      paymentBatchId: batchId,
      checkoutTokenHash: checkout.tokenHash,
      expiresAt: new Date(now.getTime() + expiryHours * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    // Ids and choices only: the donor's name and email stay out of the log.
    await recordAudit(tx, ctx, {
      action: "donation.started",
      entity: { type: "donation", id: donationId },
      before: null,
      after: {
        status,
        amountMinor: given.amountMinor.toString(),
        donorType: given.donorType,
        discloseOrganisation,
        showOnWall: given.showOnWall,
        paymentBatchId: batchId,
        guest: payerUserId === null,
      },
      actorRole: role,
    });
  });
  return { ok: true, donationId, checkoutToken: checkout.token };
}
