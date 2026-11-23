import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { entry } from "../../../db/schema";
import { invalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { decideUpload } from "../domain/submission";
import {
  authorizeEntrySubmission,
  submissionFacts,
} from "../registration-facts";
import { isImageDiscipline } from "../rules";

const inputSchema = z.object({ registrationId: z.uuid() });

/** The first-upload form for a confirmed individual or their guardian. */
export async function getEntryUploadOptions(
  ctx: UseCaseContext,
  input: { registrationId: string }
) {
  await authorize(ctx, "entry.access");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId } = parsed.data;
  const { whose } = await authorizeEntrySubmission(ctx, registrationId);

  const facts = await submissionFacts(ctx.db, registrationId);
  if (!facts) throw new Error("unreachable: authorized for no registration");
  if (facts.status !== "confirmed") {
    return { ok: false, error: "registration_not_confirmed" } as const;
  }
  const [existing] = await ctx.db
    .select({ code: entry.code })
    .from(entry)
    .where(eq(entry.registrationId, registrationId));
  if (existing)
    return { ok: false, error: "entry_exists", code: existing.code } as const;
  const disciplines = facts.competition.disciplines.filter(isImageDiscipline);
  if (disciplines.length === 0) {
    return { ok: false, error: "discipline_not_offered" } as const;
  }
  const window = facts.competition.window;
  if (!window) return { ok: false, error: "submission_not_open" } as const;
  const decision = decideUpload({ entry: null, window, now: ctx.clock.now() });
  if (!decision.ok) return { ok: false, error: decision.reason } as const;

  return {
    ok: true,
    disciplines,
    competition: facts.competition.name,
    participantName: facts.participantName,
    whose,
    closesAt: window.closesAt,
  } as const;
}
