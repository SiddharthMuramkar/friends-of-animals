"use server";

import { updateTag } from "next/cache";
import { redirect, RedirectType, unstable_rethrow } from "next/navigation";

import { applyToAdoptPath, myAdoptionApplicationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { ADOPTION_TAGS } from "@/server/modules/adoption";
import { HOME_TYPES } from "@/server/modules/adoption/domain/application-input";

// An applicant's adoption forms (#130). Each calls one use case, which
// authorizes the signed-in user and checks the input. Each comes back to a
// page saying what happened: `done` after a change, `problem` (and the
// fields to check) after a refusal.

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function to(path: string, query: Record<string, string>): never {
  const params = new URLSearchParams({ ...query, n: Date.now().toString(36) });
  redirect(`${path}?${params.toString()}`, RedirectType.replace);
}

/** Only the error's class and code: its message can hold what was typed. */
function logFailure(what: string, error: unknown) {
  unstable_rethrow(error);
  console.error(
    `Adoption ${what}: the use case failed: ${errorSummaryForLogs(error)}`
  );
}

export async function applyAction(slug: string, formData: FormData) {
  const actor = await signedIn();
  const back = applyToAdoptPath(slug);
  const documentId = text(formData, "contactSharingDocumentId");
  if (documentId === "") to(back, { problem: "consent_required" });
  const homeType = text(formData, "homeType");
  const outdoor = text(formData, "hasOutdoorSpace");
  const dateOfBirth = text(formData, "dateOfBirth");
  let applicationId: string;
  try {
    const result = await as(actor).applyToAdopt({
      slug,
      phone: text(formData, "phone"),
      address: text(formData, "address"),
      answers: {
        homeType: (HOME_TYPES as readonly string[]).includes(homeType)
          ? (homeType as (typeof HOME_TYPES)[number])
          : ("" as (typeof HOME_TYPES)[number]),
        hasOutdoorSpace: outdoor === "yes",
        otherAnimals: text(formData, "otherAnimals"),
        experience: text(formData, "experience"),
        whyThisAnimal: text(formData, "whyThisAnimal"),
      },
      ...(dateOfBirth === "" ? {} : { dateOfBirth }),
      contactSharingDocumentId: documentId,
    });
    if (!result.ok) {
      to(back, {
        problem: result.error,
        ...(result.error === "invalid_input"
          ? { fields: result.fields.join(",") }
          : {}),
      });
    }
    applicationId = result.applicationId;
  } catch (error) {
    logFailure("application", error);
    to(back, { problem: "unexpected" });
  }
  to(myAdoptionApplicationPath(applicationId), { done: "applied" });
}

export async function withdrawAction(applicationId: string) {
  const actor = await signedIn();
  const back = myAdoptionApplicationPath(applicationId);
  const result = await as(actor).withdrawAdoptionApplication({
    applicationId,
  });
  to(back, { done: result.ok ? "withdrawn" : result.error });
}

export async function storyAction(applicationId: string, formData: FormData) {
  const actor = await signedIn();
  const back = myAdoptionApplicationPath(applicationId);
  const consentDocumentId = text(formData, "consentDocumentId");
  if (consentDocumentId === "") to(back, { done: "invalid_input" });
  let outcome: string;
  try {
    const result = await as(actor).submitSuccessStory({
      applicationId,
      body: text(formData, "body"),
      consentDocumentId,
    });
    outcome = result.ok ? "storySent" : result.error;
  } catch (error) {
    logFailure("story", error);
    outcome = "unexpected";
  }
  to(back, { done: outcome });
}

export async function withdrawStoryConsentAction(applicationId: string) {
  const actor = await signedIn();
  const result = await as(actor).withdrawSuccessStoryConsent({
    applicationId,
  });
  if (result.ok) updateTag(ADOPTION_TAGS.stories);
  to(myAdoptionApplicationPath(applicationId), {
    done: result.ok ? "storyWithdrawn" : "invalid_input",
  });
}
