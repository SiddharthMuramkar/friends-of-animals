"use server";

import { redirect } from "next/navigation";
import { ADMIN_OFFLINE_DONATION, adminDonationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { secondFactorPath } from "@/lib/second-factor-routes";
import { parseRupeesToPaise } from "@/server/modules/competitions/domain/fees";
import { OFFLINE_PAYMENT_METHODS } from "@/server/modules/payments/domain/offline-payment";
import { DONOR_TYPES } from "@/server/modules/donations/domain/donor";

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return as(actor);
}

function refusal(error: unknown): {
  ok: false;
  error: "failed";
  next?: string;
} {
  if (error instanceof DomainError) {
    const path = secondFactorPath(error.code, ADMIN_OFFLINE_DONATION);
    if (path) return { ok: false, error: "failed", next: path };
  }
  console.error(`Offline donation failed: ${errorSummaryForLogs(error)}`);
  return { ok: false, error: "failed" };
}

export async function requestDonationProofAction(input: {
  contentType: string;
  sizeBytes: number;
}) {
  const cases = await signedIn();
  try {
    return await cases.requestOfflineDonationProofUpload(input);
  } catch (error) {
    return refusal(error);
  }
}

export async function completeDonationProofAction(fileId: string) {
  const cases = await signedIn();
  try {
    return { ok: (await cases.completeUpload({ fileId })).ok };
  } catch (error) {
    return refusal(error);
  }
}

export async function recordOfflineDonationAction(form: FormData) {
  const cases = await signedIn();
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const method = OFFLINE_PAYMENT_METHODS.find(
    (each) => each === text("method")
  );
  const donorType = DONOR_TYPES.find((each) => each === text("donorType"));
  const amount = parseRupeesToPaise(text("amount"));
  if (!method || !donorType || !amount.ok)
    return { ok: false, error: "invalid_input" } as const;
  try {
    const result = await cases.recordOfflineDonation({
      method,
      donorType,
      amountMinor: amount.paise,
      reference: text("reference"),
      receivedOn: text("receivedOn"),
      name: text("name"),
      email: text("email"),
      pan: text("pan"),
      organisationName: text("organisationName"),
      proofFileId: text("proofFileId"),
      declaredAdult: text("declaredAdult") === "on",
      declaredIndianSource: text("declaredIndianSource") === "on",
    });
    return result.ok
      ? ({ ok: true, next: adminDonationPath(result.donationId) } as const)
      : result;
  } catch (error) {
    return refusal(error);
  }
}
