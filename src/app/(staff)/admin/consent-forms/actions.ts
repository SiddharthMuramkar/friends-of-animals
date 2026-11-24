"use server";

import { refresh } from "next/cache";

import { orSecondFactor } from "@/app/auth/_lib/refusal";
import { adminConsentFormPath } from "@/lib/app-routes";
import { as, currentActor, type UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";

type Review = Awaited<ReturnType<UseCases["reviewConsentForm"]>>;
type ReviewState = {
  error?: Extract<Review, { ok: false }>["error"] | "forbidden";
};

export async function reviewSignedFormAction(
  formId: string,
  decision: "accept" | "reject",
  _state: ReviewState,
  data: FormData
): Promise<ReviewState> {
  const actor = await currentActor();
  if (actor.kind !== "user") return { error: "forbidden" };
  const note = data.get("note");
  const reason = data.get("reason");
  const input =
    decision === "accept"
      ? ({ formId, decision } as const)
      : ({
          formId,
          decision,
          reason: typeof reason === "string" ? reason : "",
          note: typeof note === "string" ? note : undefined,
        } as const);

  const result = await orSecondFactor(async () => {
    try {
      return await as(actor).reviewConsentForm(input);
    } catch (error) {
      if (error instanceof DomainError && error.code === "forbidden") {
        return { ok: false, error: "forbidden" } as const;
      }
      throw error;
    }
  }, adminConsentFormPath(formId));
  if (!result.ok) return { error: result.error };
  refresh();
  return {};
}
