// Shared set-up for the entries module's Seam 1 tests: a participant with a
// confirmed registration (an adult's own, or a guardian's child's), and an
// image uploaded the way the browser does it: start, PUT to the storage
// fake, complete. Test code only; nothing in the app imports it.

import type { Actor } from "@/server/actor";
import {
  adultForm,
  openToIndividuals,
  signInMember,
  type OpenCompetition,
} from "@/server/modules/participants/testing";
import type { SeedCompetitionOptions } from "@/server/seed/competitions";
import type { Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

/** A real JPEG (2000 x 1500, with GPS): what a phone sends. */
export const PHOTO = readMediaFixture("gpsJpeg");

/** The words every test entry has unless it says otherwise. */
export const ENTRY_TEXT = {
  title: "The dog at the tea stall",
  description: "Our street dog sleeping under the bench in the afternoon.",
} as const;

export type Participant = {
  actor: Actor;
  userId: string;
  email: string;
  registrationId: string;
  competition: OpenCompetition;
};

/**
 * A free competition open to individuals (drawing, painting, photography;
 * submissions close 80 days from now) and a signed-in adult whose own
 * registration for it is confirmed.
 */
export async function confirmedAdult(
  h: Harness,
  options: SeedCompetitionOptions & {
    competition?: OpenCompetition;
    name?: string;
  } = {}
): Promise<Participant> {
  const { competition: given, name, ...fields } = options;
  const competition =
    given ?? (await openToIndividuals(h, { fee: 0n, ...fields }));
  const member = await signInMember(h, name ? { name } : {});
  const registered = await h
    .as(member.actor)
    .registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const confirmed = await h
    .as(member.actor)
    .payForMyRegistration({ registrationId: registered.registrationId });
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
  return {
    ...member,
    registrationId: registered.registrationId,
    competition,
  };
}

/**
 * A verified guardian (seeded) whose 15-year-old's registration for a free
 * competition is confirmed, signed in.
 */
export async function confirmedChild(
  h: Harness,
  details: { name?: string; competition?: OpenCompetition } = {}
): Promise<Participant & { childId: string }> {
  const competition =
    details.competition ?? (await openToIndividuals(h, { fee: 0n }));
  const family = await h.seed.guardian({
    name: details.name ?? "Kavita Desai",
    children: [{ fullName: "Isha Desai", age: 15 }],
  });
  const actor = await h.signIn(family.account);
  const childId = family.childIds[0]!;
  const {
    fullName: _name,
    dateOfBirth: _dob,
    ...form
  } = adultForm(competition);
  const registered = await h
    .as(actor)
    .registerAsIndividual({ ...form, forChildId: childId });
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const confirmed = await h
    .as(actor)
    .payForMyRegistration({ registrationId: registered.registrationId });
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
  return {
    actor,
    userId: family.account.id,
    email: family.account.email,
    registrationId: registered.registrationId,
    competition,
    childId,
  };
}

export type UploadOptions = {
  bytes?: Uint8Array;
  name?: string;
  type?: string;
  discipline?: string;
  text?: { title: string; description: string; statement?: string };
};

/** The first two browser steps, with the request ready to complete. */
export async function putEntryImage(
  h: Pick<Harness, "as" | "storage">,
  who: { actor: Actor; registrationId: string },
  {
    bytes = PHOTO,
    name = "tea-stall-dog.jpg",
    type = "image/jpeg",
    discipline = "photography",
    text = ENTRY_TEXT,
  }: UploadOptions = {}
) {
  const started = await h.as(who.actor).startEntryUpload({
    registrationId: who.registrationId,
    discipline,
    file: { name, type, size: bytes.length },
  });
  if (!started.ok) throw new Error(`not started: ${JSON.stringify(started)}`);
  const stored = await h.storage.put(started.uploadUrl, bytes, started.headers);
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  return {
    registrationId: who.registrationId,
    discipline,
    fileId: started.fileId,
    ...text,
  };
}

/** The browser's upload: start, PUT the bytes, then complete. */
export async function submitImage(
  h: Harness,
  who: { actor: Actor; registrationId: string },
  options?: UploadOptions
) {
  return h
    .as(who.actor)
    .completeEntryUpload(await putEntryImage(h, who, options));
}

/** `submitImage`, which must succeed; returns the entry's code. */
export async function submittedImage(
  h: Harness,
  who: { actor: Actor; registrationId: string },
  options: UploadOptions = {}
): Promise<string> {
  const completed = await submitImage(h, who, options);
  if (!completed.ok) {
    throw new Error(`not completed: ${JSON.stringify(completed)}`);
  }
  return completed.entryCode;
}
