// Shared set-up for the export and erasure tests (#115b): a member with a
// paid registration and an entry, as the real use cases make them. Test
// code only; nothing in the app imports it.

import { eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { participantProfile } from "@/server/db/schema";
import { submittedImage } from "@/server/modules/entries/testing";
import {
  adultForm,
  openToIndividuals,
  signInMember,
  type OpenCompetition,
} from "@/server/modules/participants/testing";
import type { Harness } from "@/test/harness";

export type Participant = {
  actor: Actor;
  userId: string;
  email: string;
  profileId: string;
  registrationId: string;
  entryCode: string;
};

/**
 * A signed-in adult who registered for `competition` (paid through the
 * gateway when it has a fee), confirmed, and submitted one photo, with
 * every outbox event delivered (the scan passes it).
 */
export async function participantWithEntry(
  h: Harness,
  competition: OpenCompetition,
  details: { name: string; email: string; phone: string; dateOfBirth: string }
): Promise<Participant> {
  const member = await signInMember(h, {
    name: details.name,
    email: details.email,
  });
  const registered = await h.as(member.actor).registerAsIndividual(
    adultForm(competition, {
      fullName: details.name,
      phone: details.phone,
      dateOfBirth: details.dateOfBirth,
    })
  );
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const paid = await h
    .as(member.actor)
    .payForMyRegistration({ registrationId: registered.registrationId });
  if (!paid.ok) throw new Error(JSON.stringify(paid));
  if (paid.kind === "checkout") {
    h.gateway.capture(paid.checkout.orderId);
    await h.as(h.visitor()).receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: paid.checkout.orderId,
      })
    );
  }
  await h.drain();
  const entryCode = await submittedImage(h, {
    actor: member.actor,
    registrationId: registered.registrationId,
  });
  await h.drain();
  const [profile] = await h.db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.ownerUserId, member.userId));
  return {
    ...member,
    profileId: profile!.id,
    registrationId: registered.registrationId,
    entryCode,
  };
}

export const ASHA = {
  name: "Asha Rao",
  email: "asha@example.test",
  phone: "90000 00777",
  dateOfBirth: "1994-05-12",
} as const;

export const RAVI = {
  name: "Ravi Kumar",
  email: "ravi@example.test",
  phone: "90000 00888",
  dateOfBirth: "1991-08-23",
} as const;

/** A competition with a fee, open to individuals, taking photographs. */
export function paidCompetition(h: Harness) {
  return openToIndividuals(h, { name: "Paws on Paper" });
}

const MESSAGES_SOURCE = [
  "- We email you news about competitions.",
  "",
  "## What you agree to {#what-you-agree-to}",
  "",
  "News and updates by email.",
].join("\n");

/**
 * Publishes a messages consent document (as a new super admin) and has
 * `who` give consent to it: a consent an erasure must withdraw.
 */
export async function withMessagesConsent(h: Harness, who: { actor: Actor }) {
  const admin = await h.seed.superAdmin({
    email: `publisher-${crypto.randomUUID()}@example.test`,
  });
  const published = await h.as(await h.signIn(admin)).publishConsentDocument({
    purpose: "messages",
    title: "News and updates",
    source: MESSAGES_SOURCE,
  });
  if (!published.ok) throw new Error("Could not publish");
  const given = await h
    .as(who.actor)
    .giveConsent({ purpose: "messages", documentId: published.id });
  if (!given.ok) throw new Error(JSON.stringify(given));
}
