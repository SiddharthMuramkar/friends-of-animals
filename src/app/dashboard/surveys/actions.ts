"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { surveyAnswerPath, feedbackPath } from "@/lib/app-routes";
import { DomainError } from "@/server/errors";
export async function answerAction(
  target: { competitionId: string } | { token: string },
  data: FormData
) {
  let status: string;
  try {
    const indices = Array.from(data.keys()).flatMap((key) =>
      /^q[0-9]$/.test(key) ? [Number(key.slice(1))] : []
    );
    const answers = Array.from(
      { length: Math.max(-1, ...indices) + 1 },
      (_, i) => {
        const values = data.getAll(`q${i}`);
        return values.length === 1 &&
          typeof values[0] === "string" &&
          /^\d+$/.test(values[0])
          ? Number(values[0])
          : NaN;
      }
    );
    const result = await as(await currentActor()).answerSurvey({
      ...target,
      answers,
    });
    status = result.ok ? "complete" : result.error;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    status = "forbidden";
  }
  redirect(
    "token" in target
      ? `${feedbackPath(target.token)}?result=${status}`
      : `${surveyAnswerPath(target.competitionId)}&result=${status}`
  );
}
