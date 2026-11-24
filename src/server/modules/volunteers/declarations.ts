// The applicant's two declarations (#123): the safeguarding declaration and
// the code of conduct, each a consent on a document staff publish. They
// are recorded through the consent module's event log, given by web form
// on the version the applicant was shown, which must be the current one.
// Approval reads them back (./domain/approval.ts decides).
//
// Loads under plain Node: relative imports only, no "server-only".

import type { AppDb } from "../../db/app-db";
import { appendConsentEvent } from "../consent/consents";
import type { ConsentContext } from "../consent/documents";
import { currentConsent } from "../consent/domain/consent-state";
import type { VolunteerPurpose } from "../consent/domain/purposes";
import {
  latestDocument,
  subjectEvents,
  type ConsentSubject,
} from "../consent/repository";
import type { DeclarationState } from "./domain/approval";

export const DECLARATION_PURPOSES = {
  safeguarding: "volunteer_safeguarding_declaration",
  conduct: "volunteer_code_of_conduct",
} as const satisfies Record<string, VolunteerPurpose>;

export type DeclarationKey = keyof typeof DECLARATION_PURPOSES;

/** The document ids an applicant accepted, as the form sends them. */
export type AcceptedDeclarations = {
  safeguardingDocumentId: string;
  conductDocumentId: string;
};

export type DeclarationRefusal =
  | "declaration_unpublished"
  | "declaration_outdated";

/**
 * Records the user's acceptance of both declarations on the versions they
 * were shown, inside the caller's transaction, holding the user's row
 * lock. Both must be the current versions, or nothing is recorded. An
 * acceptance already given on that version records nothing again.
 */
export async function recordDeclarations(
  tx: AppDb,
  ctx: ConsentContext,
  userId: string,
  accepted: AcceptedDeclarations
): Promise<{ ok: true; changed: boolean } | { ok: false; error: DeclarationRefusal }> {
  const shown = {
    safeguarding: accepted.safeguardingDocumentId,
    conduct: accepted.conductDocumentId,
  };
  const keys = Object.keys(DECLARATION_PURPOSES) as DeclarationKey[];
  const latest = await Promise.all(
    keys.map((key) => latestDocument(tx, DECLARATION_PURPOSES[key]))
  );
  if (latest.some((document) => document === null)) {
    return { ok: false, error: "declaration_unpublished" };
  }
  if (keys.some((key, k) => latest[k]!.id !== shown[key])) {
    return { ok: false, error: "declaration_outdated" };
  }
  const subject: ConsentSubject = { type: "user", id: userId };
  let changed = false;
  for (const key of keys) {
    const purpose = DECLARATION_PURPOSES[key];
    const state = currentConsent(await subjectEvents(tx, subject, purpose));
    if (state.status === "given" && state.documentId === shown[key]) continue;
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: userId,
      purpose,
      action: "given",
      documentId: shown[key],
      method: "web_form",
    });
    changed = true;
  }
  return { ok: true, changed };
}

/**
 * Each declaration as approval weighs it: the user's latest consent (with
 * the event that recorded it) and the purpose's current document.
 */
export async function declarationStates(
  db: AppDb,
  userId: string
): Promise<Record<DeclarationKey, DeclarationState>> {
  const subject: ConsentSubject = { type: "user", id: userId };
  const entries = await Promise.all(
    (Object.keys(DECLARATION_PURPOSES) as DeclarationKey[]).map(
      async (key) => {
        const purpose = DECLARATION_PURPOSES[key];
        // Newest first, in the order the consent log reads its state.
        const events = await subjectEvents(db, subject, purpose);
        const latest = events[0];
        const document = await latestDocument(db, purpose);
        const state: DeclarationState = {
          consent:
            latest === undefined
              ? { state: "never" }
              : latest.action === "given"
                ? {
                    state: "given",
                    documentId: latest.documentId,
                    consentEventId: latest.id,
                  }
                : { state: "withdrawn", documentId: latest.documentId },
          currentDocumentId: document?.id ?? null,
        };
        return [key, state] as const;
      }
    )
  );
  return Object.fromEntries(entries) as Record<DeclarationKey, DeclarationState>;
}

/** How one declaration stands, for the pages: current, outdated or missing. */
export type DeclarationStanding = "current" | "outdated" | "missing";

export function standingOf(state: DeclarationState): DeclarationStanding {
  if (state.consent.state !== "given") return "missing";
  return state.consent.documentId === state.currentDocumentId
    ? "current"
    : "outdated";
}
