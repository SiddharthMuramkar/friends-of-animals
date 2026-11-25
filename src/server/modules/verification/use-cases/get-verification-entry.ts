import { and, eq, notExists, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../../access/can";
import { alias } from "drizzle-orm/pg-core";
import {
  entry,
  entryFile,
  competition,
  registration,
} from "../../../db/schema";
import { invalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { moduleDerivativeUrl } from "../../files/use-cases/derivative-url";
import { moduleFileUrl } from "../../files/use-cases/delivery";
import { sanitizeEssayBody } from "../../../rich-text/essay";

/** Read only work eligible for FOA verification. No participant identities. */
export async function getVerificationEntry(
  ctx: UseCaseContext,
  input: { entryId: string }
) {
  await authorize(ctx, "verification.read");
  const parsed = z.object({ entryId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const pending = alias(entryFile, "pending_file");
  const [row] = await ctx.db
    .select({
      id: entry.id,
      code: entry.code,
      title: entry.title,
      description: entry.description,
      statement: entry.statement,
      discipline: entry.discipline,
      competition: competition.name,
      asset: entryFile.fileAssetId,
      kind: entryFile.kind,
      essayBody: entryFile.essayBody,
    })
    .from(entry)
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .innerJoin(
      entryFile,
      and(eq(entryFile.entryId, entry.id), eq(entryFile.status, "live"))
    )
    .where(
      and(
        eq(entry.id, parsed.data.entryId),
        eq(entry.status, "submitted_to_foa"),
        ne(competition.status, "cancelled"),
        eq(registration.status, "confirmed"),
        notExists(
          ctx.db
            .select({ id: pending.id })
            .from(pending)
            .where(
              and(
                eq(pending.entryId, entry.id),
                inArray(pending.status, ["pending", "processing"])
              )
            )
        )
      )
    );
  if (!row) return { ok: false, error: "not_found" } as const;
  const { asset, kind, essayBody, ...details } = row;
  const picture =
    asset && kind === "image"
      ? await moduleDerivativeUrl(ctx, asset, "display_1600")
      : null;
  const video =
    asset && kind === "video"
      ? await moduleDerivativeUrl(ctx, asset, "video_mp4")
      : null;
  const document =
    asset && kind === "document" ? await moduleFileUrl(ctx, asset) : null;
  return {
    ok: true,
    entry: {
      ...details,
      picture,
      video,
      document,
      essay: kind === "text" && essayBody ? sanitizeEssayBody(essayBody) : null,
    },
  } as const;
}
