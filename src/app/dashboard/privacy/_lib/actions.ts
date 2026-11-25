"use server";

import { redirect, RedirectType } from "next/navigation";

import { MY_PRIVACY_REQUESTS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { SubmitPrivacyRequestInput } from "@/server/modules/privacy/requests";

import {
  newRequestErrorHref,
  viewOutcomeHref,
  type NewRequestError,
} from "./outcome";

// A requester's steps (#115): make a request, cancel one, download a
// copy of the data. Each runs its use case, which checks who may, then
// sends the browser on with the outcome in the address (./outcome.ts).

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** What the form sent, as the use case's input; the use case checks it. */
function filingFrom(formData: FormData): SubmitPrivacyRequestInput {
  const subject = text(formData, "subject");
  const details = text(formData, "correctionDetails").trim();
  return {
    type: text(formData, "type") as SubmitPrivacyRequestInput["type"],
    subject:
      subject === "self" || subject === ""
        ? { kind: "self" }
        : { kind: "child", childId: subject },
    ...(details === "" ? {} : { correctionDetails: details }),
  };
}

export async function submitPrivacyRequestAction(
  formData: FormData
): Promise<void> {
  const actor = await signedIn();
  if (text(formData, "subject") === "" || text(formData, "type") === "") {
    redirect(newRequestErrorHref("invalid_input"), RedirectType.replace);
  }
  let target: string;
  try {
    const result = await as(actor).submitPrivacyRequest(filingFrom(formData));
    target = result.ok
      ? viewOutcomeHref(result.requestId, { result: "filed" })
      : newRequestErrorHref(result.error as NewRequestError);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      target = newRequestErrorHref("forbidden");
    } else {
      throw error;
    }
  }
  redirect(target, RedirectType.replace);
}

export async function cancelPrivacyRequestAction(
  formData: FormData
): Promise<void> {
  const actor = await signedIn();
  const id = text(formData, "requestId");
  let target = MY_PRIVACY_REQUESTS;
  try {
    const result = await as(actor).cancelPrivacyRequest({ id });
    target = viewOutcomeHref(
      id,
      result.ok
        ? { result: "cancelled" }
        : {
            error:
              result.error === "already_in_progress"
                ? "already_in_progress"
                : "request_closed",
          }
    );
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
  }
  redirect(target, RedirectType.replace);
}

/** Sends the requester to a fresh 5-minute download URL for their copy. */
export async function downloadPrivacyExportAction(
  formData: FormData
): Promise<void> {
  const actor = await signedIn();
  const id = text(formData, "requestId");
  let target = MY_PRIVACY_REQUESTS;
  try {
    const link = await as(actor).getPrivacyExportLink({ id });
    if (link.ok) {
      target = link.url;
    } else if (link.error !== "invalid_input") {
      target = viewOutcomeHref(id, { error: link.error });
    }
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
  }
  redirect(target, RedirectType.replace);
}
