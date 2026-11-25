import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { certificate } from "../../db/schema";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import { queueStamp, stampedImageUrl } from "../stamping";
import { certificateOwner, ownedProfiles } from "./read";

type ShareInput = { certificateId: string };
async function withOwnedCertificate<T>(
  ctx: UseCaseContext,
  input: ShareInput,
  action: "certificate.request_share" | "certificate.download_share",
  use: (ctx: UseCaseContext, row: typeof certificate.$inferSelect) => Promise<T>
) {
  const ids = await ownedProfiles(ctx);
  if (!ids.length || !z.uuid().safeParse(input.certificateId).success)
    throw new DomainError("forbidden", "Certificate access denied");
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(certificate)
      .where(
        and(
          eq(certificate.id, input.certificateId),
          inArray(certificate.participantProfileId, ids)
        )
      )
      .for("update");
    await authorize({ ...ctx, db: tx }, action, {
      ownerId: row
        ? await certificateOwner({ ...ctx, db: tx }, row)
        : undefined,
    });
    if (
      !row ||
      row.status !== "issued" ||
      row.renderStatus !== "rendered" ||
      !row.pdfFileId
    )
      return { ok: false, error: "not_ready" } as const;
    return use({ ...ctx, db: tx }, row);
  });
}

export function requestCertificateShare(
  ctx: UseCaseContext,
  input: ShareInput
) {
  return withOwnedCertificate(
    ctx,
    input,
    "certificate.request_share",
    async (ctx, row) => {
      const status = await queueStamp(ctx.db, ctx.clock, {
        fileId: row.pdfFileId!,
        variant: "certificate_share",
      });
      if (status === "unavailable")
        return { ok: false, error: "not_ready" } as const;
      return { ok: true, status } as const;
    }
  );
}
export function getCertificateShareUrl(ctx: UseCaseContext, input: ShareInput) {
  return withOwnedCertificate(
    ctx,
    input,
    "certificate.download_share",
    async (ctx, row) => {
      const result = await stampedImageUrl(ctx, {
        fileId: row.pdfFileId!,
        variant: "certificate_share",
        filename: `${row.number}.png`,
      });
      if (!result) return { ok: false, error: "not_ready" } as const;
      await recordAudit(ctx.db, ctx, {
        action: "certificate.share_downloaded",
        entity: { type: "certificate", id: row.id },
        before: null,
        after: null,
        actorRole: null,
      });
      return { ok: true, ...result } as const;
    }
  );
}
