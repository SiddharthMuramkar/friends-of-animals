"use server";
import { redirect } from "next/navigation";
import { judgeEntryPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import type { SaveScoreSheetInput } from "@/server/modules/judging/blind";

export async function saveScorePatch(input: SaveScoreSheetInput) {
  return as(await currentActor()).saveScoreSheet(input);
}

/** The same use case handles the progressive, non-JavaScript form post.
 * Form fields name their baseline values so it also submits a patch, never
 * replaces the whole sheet. The server validates every submitted change. */
export async function submitScoreForm(
  roundId: string,
  entryCode: string,
  data: FormData
) {
  const scores: Record<string, number | null> = {};
  for (const [name, value] of data.entries()) {
    if (!name.startsWith("score:") || typeof value !== "string") continue;
    const id = name.slice("score:".length);
    if (value !== data.get(`original:${id}`))
      scores[id] = value === "" ? null : Number(value);
  }
  const comment = data.get("comment");
  const result = await saveScorePatch({
    roundId,
    entryCode,
    baseVersion: Number(data.get("baseVersion")),
    scores,
    ...(typeof comment === "string" && comment !== data.get("originalComment")
      ? { comment }
      : {}),
  });
  const state = result.ok
    ? result.conflicts.length
      ? "conflict"
      : "saved"
    : result.error === "invalid_scores" || result.error === "invalid_input"
      ? "invalid"
      : result.error === "round_locked"
        ? "locked"
        : "closed";
  redirect(`${judgeEntryPath(roundId, entryCode)}?saved=${state}`);
}
