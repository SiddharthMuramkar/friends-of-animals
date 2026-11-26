// Attaching consent documents to a competition (#72).
//
//   attachConsentDocument({ competitionId, purpose: "competition_terms" })
//   detachConsentDocument({ competitionId, purpose })
//     → a competition manager, globally or for this competition
//
// Attaching pins the purpose's latest published version (#64). Publishing
// a newer one changes nothing here until a manager attaches again, so
// consent given for the competition always names the text people saw.
// Loads under plain Node: relative imports only.

import { hasUnsettledAuctionLots } from "../../auctions/reservations";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { competitionConsentDocument } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import {
  decideAttach,
  isAttachablePurpose,
  type AttachError,
} from "../domain/consent-attachments";
import type { TermsContext } from "./fees";
import { competitionResource } from "./policy";
import { latestDocuments, lockCompetition, pinnedDocument } from "./repository";

export type ConsentDocumentChangeInput = {
  competitionId: string;
  purpose: string;
};

export type AttachConsentDocumentResult =
  | {
      ok: true;
      changed: boolean;
      document: { id: string; version: number };
    }
  | InvalidInput
  | { ok: false; error: "not_found" | "auction_active" | AttachError };

export type DetachConsentDocumentResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | { ok: false; error: "not_found" | "not_attachable" | "auction_active" };

const changeInput = z.object({
  competitionId: z.uuid(),
  purpose: z.string().max(64),
});

/**
 * Pins the latest published version of the purpose's document, attaching
 * it or moving an older pin forward. Pinning the version already pinned
 * is a no-op (`changed: false`) and records nothing.
 */
export async function attachConsentDocument(
  ctx: TermsContext,
  input: ConsentDocumentChangeInput
): Promise<AttachConsentDocumentResult> {
  const resource = competitionResource(input.competitionId);
  const { role } = await authorize(
    ctx,
    "competition.attach_document",
    resource
  );
  const valid = changeInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { competitionId, purpose } = valid.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const found = await lockCompetition(tx, competitionId);
    if (!found) return { ok: false, error: "not_found" } as const;
    if (!isAttachablePurpose(purpose)) {
      return { ok: false, error: "not_attachable" } as const;
    }
    const latest = (await latestDocuments(tx)).get(purpose) ?? null;
    const pinned = await pinnedDocument(tx, competitionId, purpose);
    const decided = decideAttach(purpose, latest, pinned);
    if (!decided.ok) return decided;
    const document = {
      id: decided.value.documentId,
      version: decided.value.version,
    };
    if (!decided.value.changed) {
      return { ok: true, changed: false, document } as const;
    }

    if (
      purpose === "auction" &&
      (await hasUnsettledAuctionLots(tx, competitionId))
    )
      return { ok: false, error: "auction_active" } as const;
    await tx
      .insert(competitionConsentDocument)
      .values({
        competitionId,
        purpose,
        consentDocumentId: document.id,
        attachedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        attachedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          competitionConsentDocument.competitionId,
          competitionConsentDocument.purpose,
        ],
        set: {
          consentDocumentId: sql`excluded.consent_document_id`,
          attachedByUserId: sql`excluded.attached_by_user_id`,
          attachedAt: sql`excluded.attached_at`,
        },
      });
    await recordAudit(tx, ctx, {
      action: "competition.consent_document_attached",
      entity: { type: "competition", id: competitionId },
      before: pinned
        ? { purpose, documentId: pinned.id, version: pinned.version }
        : null,
      after: { purpose, documentId: document.id, version: document.version },
      actorRole: role,
    });
    return { ok: true, changed: true, document } as const;
  });
}

/**
 * Removes the purpose's pin. A purpose with no pin is a no-op
 * (`changed: false`) and records nothing.
 */
export async function detachConsentDocument(
  ctx: TermsContext,
  input: ConsentDocumentChangeInput
): Promise<DetachConsentDocumentResult> {
  const resource = competitionResource(input.competitionId);
  const { role } = await authorize(
    ctx,
    "competition.attach_document",
    resource
  );
  const valid = changeInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { competitionId, purpose } = valid.data;

  return ctx.db.transaction(async (tx) => {
    const found = await lockCompetition(tx, competitionId);
    if (!found) return { ok: false, error: "not_found" } as const;
    if (!isAttachablePurpose(purpose)) {
      return { ok: false, error: "not_attachable" } as const;
    }
    const pinned = await pinnedDocument(tx, competitionId, purpose);
    if (!pinned) return { ok: true, changed: false } as const;

    if (
      purpose === "auction" &&
      (await hasUnsettledAuctionLots(tx, competitionId))
    )
      return { ok: false, error: "auction_active" } as const;
    await tx
      .delete(competitionConsentDocument)
      .where(
        and(
          eq(competitionConsentDocument.competitionId, competitionId),
          eq(competitionConsentDocument.purpose, purpose)
        )
      );
    await recordAudit(tx, ctx, {
      action: "competition.consent_document_detached",
      entity: { type: "competition", id: competitionId },
      before: { purpose, documentId: pinned.id, version: pinned.version },
      after: null,
      actorRole: role,
    });
    return { ok: true, changed: true } as const;
  });
}
