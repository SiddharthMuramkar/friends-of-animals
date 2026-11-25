import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { authorize } from "../../access/can";
import type { Actor } from "../../actor";
import {
  certificate,
  certificateReadyNotice,
  competition,
  fileAsset,
} from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { OutboxDeps } from "../../outbox/handlers";
import { PdfRenderError, unconfiguredPdfRenderer } from "../../ports/pdf";
import { lockSubject } from "../privacy/requests/submit";
import { storageKeyFor } from "../files/domain/storage-key";
import { certificateDocument } from "./document";
import { readyCertificateRecipients } from "./messages";
import { afterRenderFailure } from "./domain/status";
export type RenderContext = Pick<
  OutboxDeps,
  "db" | "clock" | "files" | "auth" | "pdf" | "cipher"
> & { actor: Actor; storage: Pick<OutboxDeps["storage"], "write"> };
export async function renderCertificate(
  ctx: RenderContext,
  { certificateId }: { certificateId: string }
) {
  await authorize(ctx, "certificates.render");
  const retry = await ctx.db.transaction(async (tx) => {
    const [hint] = await tx
      .select({
        competitionId: certificate.competitionId,
        participantProfileId: certificate.participantProfileId,
        recipientUserId: certificate.recipientUserId,
      })
      .from(certificate)
      .where(eq(certificate.id, certificateId));
    // Serialize with subject erasure before taking the competition lock.
    if (hint?.recipientUserId) await lockSubject(tx, hint.recipientUserId);
    if (hint?.participantProfileId)
      await lockSubject(tx, hint.participantProfileId);
    // Serialize readiness decisions across the release, not merely one PDF.
    if (hint?.competitionId)
      await tx
        .select({ id: competition.id })
        .from(competition)
        .where(eq(competition.id, hint.competitionId))
        .for("update");
    const [row] = await tx
      .select()
      .from(certificate)
      .where(eq(certificate.id, certificateId))
      .for("update");
    if (!row || row.status !== "issued" || row.renderStatus !== "pending")
      return false;
    const [comp] = row.competitionId
      ? await tx
          .select({ code: competition.code, name: competition.name })
          .from(competition)
          .where(eq(competition.id, row.competitionId))
      : [];
    const now = ctx.clock.now();
    let bytes: Uint8Array;
    const fileId = row.id;
    const prefix = ctx.files.keyPrefix;
    try {
      if (prefix === null || !ctx.auth.baseUrl) throw new PdfRenderError();
      bytes = await (ctx.pdf ?? unconfiguredPdfRenderer).render({
        template: "certificate",
        version: row.templateVersion,
        data: certificateDocument(row, comp ?? null, ctx.auth.baseUrl),
      });
      if (
        new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-" ||
        bytes.length > 10 * 1024 * 1024
      )
        throw new PdfRenderError();
      const key = storageKeyFor({ prefix, purpose: "certificate_pdf", fileId });
      await ctx.storage.write({
        bucket: ctx.files.bucket,
        key,
        body: bytes,
        contentType: "application/pdf",
      });
    } catch {
      const next = afterRenderFailure({
        attempts: row.renderAttempts,
        maxAttempts: 3,
      });
      await tx
        .update(certificate)
        .set({ renderAttempts: next.attempts, renderStatus: next.status })
        .where(eq(certificate.id, row.id));
      return next.shouldRequeue;
    }
    {
      const key = storageKeyFor({
        prefix: prefix!,
        purpose: "certificate_pdf",
        fileId,
      });
      await tx.insert(fileAsset).values({
        id: fileId,
        ownerUserId: null,
        purpose: "certificate_pdf",
        status: "clean",
        contentType: "application/pdf",
        sizeBytes: bytes.length,
        bucket: ctx.files.bucket,
        storageKey: key,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scanResult: "generated",
        scannedAt: now,
        uploadedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .update(certificate)
        .set({
          pdfFileId: fileId,
          renderStatus: "rendered",
          renderAttempts: row.renderAttempts + 1,
        })
        .where(eq(certificate.id, row.id));
    }
    if (row.sourceReleaseId && row.competitionId) {
      const recipients = await readyCertificateRecipients(
        tx,
        row.sourceReleaseId,
        ctx.cipher
      );
      for (const recipientUserId of recipients) {
        const inserted = await tx
          .insert(certificateReadyNotice)
          .values({
            releaseId: row.sourceReleaseId,
            recipientUserId,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length)
          await emit(tx, ctx.clock, {
            type: "certificates.ready",
            aggregate: { type: "competition", id: row.competitionId },
            payload: {
              competitionId: row.competitionId,
              releaseId: row.sourceReleaseId,
              recipientUserId,
            },
          });
      }
    }
    return false;
  });
  if (retry) throw new PdfRenderError();
}
