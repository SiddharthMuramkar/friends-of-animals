"use server";

import { redirect, RedirectType } from "next/navigation";

import { RECEIPT_REQUEST } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";

// The receipt request form's Server Action (#106): a guest asks for a new
// link with their email and receipt number. Whatever the answer, the page
// says the same when the details were taken, so nobody learns whether an
// address gave; only the limits and a broken form say otherwise.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function requestReceiptLinkAction(formData: FormData) {
  let done: "sent" | "invalid" | "limited" | "failed";
  try {
    const result = await as(await currentActor()).requestReceiptLinkByEmail({
      email: text(formData, "email"),
      receiptNumber: text(formData, "receiptNumber"),
    });
    done = result.ok
      ? "sent"
      : result.error === "rate_limited"
        ? "limited"
        : "invalid";
  } catch (error) {
    console.error(
      `requestReceiptLinkByEmail failed: ${errorSummaryForLogs(error)}`
    );
    done = "failed";
  }
  redirect(`${RECEIPT_REQUEST}?done=${done}`, RedirectType.replace);
}
