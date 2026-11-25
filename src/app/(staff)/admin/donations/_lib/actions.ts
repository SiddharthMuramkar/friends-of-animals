"use server";

import { getFormatter, getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { adminDonationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import type { Actor } from "@/server/actor";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";

import type { LinkFormState } from "./link-state";

// The donation page's Server Actions (#106). Asking for and deciding a
// refund come back to the donation's page saying what happened (`done` or
// `problem` in the query); a decision needs a second factor passed in the
// last 10 minutes (#60), so a refusal sends finance to step up, then back.
// A new receipt link comes back to the form that asked, never in a URL.
// Anything unexpected is logged by class only.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedIn(): Promise<Actor> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** Sends a second-factor refusal to the page that lifts it, then `back`. */
function liftSecondFactor(error: unknown, back: string): void {
  if (!(error instanceof DomainError)) return;
  const path = secondFactorPath(error.code, back);
  if (path) redirect(path);
}

function back(donationId: string, key: "done" | "problem", value: string) {
  redirect(
    `${adminDonationPath(donationId)}?${key}=${encodeURIComponent(value)}`,
    RedirectType.replace
  );
}

export async function makeReceiptLinkAction(
  previous: LinkFormState,
  formData: FormData
): Promise<LinkFormState> {
  const actor = await signedIn();
  const donationId = text(formData, "donationId");
  try {
    const result = await as(actor).reissueReceiptLink({ donationId });
    if (result.ok && result.issuedTo === "finance") {
      const [t, format] = await Promise.all([
        getTranslations("adminDonations.link"),
        getFormatter(),
      ]);
      return {
        attempt: previous.attempt + 1,
        link: {
          path: result.path,
          validUntil: t("made", {
            date: format.dateTime(result.expiresAt, {
              dateStyle: "long",
              timeStyle: "short",
            }),
          }),
        },
      };
    }
    return {
      attempt: previous.attempt + 1,
      problem:
        !result.ok && result.error === "receipt_cancelled"
          ? "cancelled"
          : "failed",
    };
  } catch (error) {
    liftSecondFactor(error, adminDonationPath(donationId));
    console.error(`reissueReceiptLink failed: ${errorSummaryForLogs(error)}`);
    return { attempt: previous.attempt + 1, problem: "failed" };
  }
}

export async function requestDonationRefundAction(formData: FormData) {
  const actor = await signedIn();
  const donationId = text(formData, "donationId");
  let outcome: { key: "done" | "problem"; value: string };
  try {
    const result = await as(actor).requestDonationRefund({
      donationId,
      reason: text(formData, "reason"),
    });
    outcome = result.ok
      ? { key: "done", value: "requested" }
      : {
          key: "problem",
          value:
            result.error === "invalid_input" || result.error === "not_found"
              ? "failed"
              : result.error,
        };
  } catch (error) {
    liftSecondFactor(error, adminDonationPath(donationId));
    console.error(
      `requestDonationRefund failed: ${errorSummaryForLogs(error)}`
    );
    outcome = { key: "problem", value: "failed" };
  }
  back(donationId, outcome.key, outcome.value);
}

export async function decideDonationRefundAction(formData: FormData) {
  const actor = await signedIn();
  const donationId = text(formData, "donationId");
  const refundId = text(formData, "refundId");
  const decision = text(formData, "decision");
  const note = text(formData, "note");
  let outcome: { key: "done" | "problem"; value: string };
  try {
    const refunds = as(actor);
    const result =
      decision === "approve"
        ? await refunds.approveRefund({ refundId })
        : await refunds.rejectRefund({ refundId, note });
    outcome = result.ok
      ? { key: "done", value: result.status }
      : {
          key: "problem",
          value:
            result.error === "invalid_input" || result.error === "not_found"
              ? "failed"
              : result.error,
        };
  } catch (error) {
    liftSecondFactor(error, adminDonationPath(donationId));
    console.error(
      `deciding a donation refund failed: ${errorSummaryForLogs(error)}`
    );
    outcome = { key: "problem", value: "failed" };
  }
  back(donationId, outcome.key, outcome.value);
}
