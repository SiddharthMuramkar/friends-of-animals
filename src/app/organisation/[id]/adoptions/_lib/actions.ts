"use server";

import { refresh, updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { adoptionPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { ADOPTION_TAGS } from "@/server/modules/adoption";
import { StorageNotConfiguredError } from "@/server/ports/storage";

import {
  afterResult,
  detailsFrom,
  valuesFrom,
  type AnimalFormState,
} from "./form-state";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedInActor() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function logUnexpected(name: string, error: unknown) {
  if (!(error instanceof DomainError)) {
    console.error(`${name} failed: ${errorSummaryForLogs(error)}`);
  }
}

/** What the public pages show of an animal changed: browse and its page. */
function refreshPublic(slug: string) {
  updateTag(ADOPTION_TAGS.all);
  updateTag(ADOPTION_TAGS.animal(slug));
}

/** Saves a new animal as a draft, then opens its page. */
export async function createAnimalAction(
  previous: AnimalFormState,
  formData: FormData
): Promise<AnimalFormState> {
  const actor = await signedInActor();
  const directoryListingId = text(formData, "directoryListingId");
  const values = valuesFrom(formData);
  let result;
  try {
    result = await as(actor).createAdoptionListing({
      ...detailsFrom(values),
      directoryListingId,
    });
  } catch (error) {
    logUnexpected("createAdoptionListing", error);
    return afterResult(previous, values, "unexpected");
  }
  if (!result.ok) return afterResult(previous, values, result);
  redirect(
    `${adoptionPath(directoryListingId, result.adoptionListingId)}?notice=created`,
    RedirectType.replace
  );
}

/** Saves an animal's details, then shows its page with what happened. */
export async function updateAnimalAction(
  previous: AnimalFormState,
  formData: FormData
): Promise<AnimalFormState> {
  const actor = await signedInActor();
  const adoptionListingId = text(formData, "adoptionListingId");
  const values = valuesFrom(formData);
  let result;
  try {
    result = await as(actor).updateAdoptionListing({
      ...detailsFrom(values),
      adoptionListingId,
    });
  } catch (error) {
    logUnexpected("updateAdoptionListing", error);
    return afterResult(previous, values, "unexpected");
  }
  if (!result.ok) return afterResult(previous, values, result);
  if (result.changed) refreshPublic(result.slug);
  redirect(
    `${adoptionPath(result.directoryListingId, adoptionListingId)}?notice=${result.changed ? "saved" : "unchanged"}`,
    RedirectType.replace
  );
}

const MOVES = {
  publish: { useCase: "publishAdoptionListing", notice: "published" },
  hold: { useCase: "holdAdoptionListing", notice: "held" },
  resume: { useCase: "resumeAdoptionListing", notice: "resumed" },
  withdraw: { useCase: "withdrawAdoptionListing", notice: "withdrawn" },
} as const satisfies Record<
  string,
  { useCase: keyof UseCases; notice: string }
>;

/** Publishes, holds, resumes or withdraws an animal, then shows its page. */
export async function moveAnimalAction(formData: FormData): Promise<void> {
  const actor = await signedInActor();
  const directoryListingId = text(formData, "directoryListingId");
  const adoptionListingId = text(formData, "adoptionListingId");
  const back = adoptionPath(directoryListingId, adoptionListingId);
  const move = MOVES[text(formData, "move") as keyof typeof MOVES];
  if (!move) redirect(`${back}?error=invalid_input`, RedirectType.replace);
  let result;
  try {
    result = await as(actor)[move.useCase]({ adoptionListingId });
  } catch (error) {
    logUnexpected(move.useCase, error);
    redirect(`${back}?error=unexpected`, RedirectType.replace);
  }
  if (!result.ok)
    redirect(`${back}?error=${result.error}`, RedirectType.replace);
  refreshPublic(result.slug);
  redirect(`${back}?notice=${move.notice}`, RedirectType.replace);
}

/** Saves a photo's new text alternative, or removes the photo. */
export async function changePhotoAction(formData: FormData): Promise<void> {
  const actor = await signedInActor();
  const directoryListingId = text(formData, "directoryListingId");
  const adoptionListingId = text(formData, "adoptionListingId");
  const photoId = text(formData, "photoId");
  const back = adoptionPath(directoryListingId, adoptionListingId);
  const removing = text(formData, "intent") === "remove";
  let result;
  try {
    result = removing
      ? await as(actor).removeAdoptionPhoto({ photoId })
      : await as(actor).describeAdoptionPhoto({
          photoId,
          altText: text(formData, "altText"),
        });
  } catch (error) {
    logUnexpected(
      removing ? "removeAdoptionPhoto" : "describeAdoptionPhoto",
      error
    );
    redirect(`${back}?error=unexpected`, RedirectType.replace);
  }
  if (!result.ok)
    redirect(`${back}?error=${result.error}`, RedirectType.replace);
  refreshPublic(result.slug);
  redirect(
    `${back}?notice=${removing ? "photoRemoved" : "photoDescribed"}`,
    RedirectType.replace
  );
}

type UploadInput = Parameters<UseCases["requestAdoptionPhotoUpload"]>[0];

/** Presigns one photo's upload; the browser PUTs it, then completes. */
export async function requestAdoptionPhotoUploadAction(input: UploadInput) {
  const actor = await currentActor();
  if (actor.kind !== "user") return { ok: false, error: "forbidden" } as const;
  try {
    return await as(actor).requestAdoptionPhotoUpload(input);
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: "forbidden" } as const;
    }
    if (error instanceof StorageNotConfiguredError) {
      return { ok: false, error: "unexpected" } as const;
    }
    throw error;
  }
}

/** Shows the animal's page again once an upload has completed. */
export async function refreshAnimalAction() {
  refresh();
}
