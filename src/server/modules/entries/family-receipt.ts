// The school route's receipt (#87), sent by the outbox handler
// entries.send_family_receipt after entry.submitted: once a student's first
// file passes its checks, an email to the student's family contact naming
// the Entry ID, the student, the competition and the institution. The
// contact is a minor's guardian, or an adult student themself, kept
// encrypted on the participant profile (#75), not a user, so #69's
// dispatcher can't reach them: their route row (audience `family_contact`)
// resolves to nobody, and this handler renders its template instead, as the
// registration confirmation does (registration/confirmation-message.ts).
// The coordinator who uploaded is told nothing: the roster shows it.
//
// An individual registration's family hears by route row instead
// (`registration_owner`, `guardian_of_participant`), so this sends nothing
// for one. Email only: SMS waits for registered DLT templates (HR-14).
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";

import { registration } from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { familyContactEmail } from "../registration/confirmation-message";
import { entryValues } from "./message-values";

export async function sendEntryReceiptToFamily(
  deps: OutboxDeps,
  delivery: Delivery<"entry.submitted">
): Promise<void> {
  const { registrationId } = delivery.payload;
  const [row] = await deps.db
    .select({ route: registration.route })
    .from(registration)
    .where(eq(registration.id, registrationId));
  if (row?.route !== "institution") return;
  const message = await familyContactEmail(deps, {
    eventType: delivery.eventType,
    registrationId,
    // A refund (#80) or a cancellation since: nothing to send.
    sendWhile: (status) => status === "confirmed",
    values: () => entryValues(deps.db, delivery.payload, true),
  });
  if (message) await deps.email.send(message, { deliveryId: delivery.id });
}
