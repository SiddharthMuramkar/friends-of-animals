"use server";

import { updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { adminAdoptionApplicationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { ADOPTION_TAGS } from "@/server/modules/adoption";

import { adminCall } from "../../_lib/boundary";

// The adoption coordinator's moves on an application (#130). Each calls one
// use case, which authorizes (the adoption coordinator, global or for the
// organisation, with this session's second factor) and checks the move. A
// second-factor refusal goes to the page that lifts it, then back. Each
// comes back to the application saying what happened: `done`, or
// `refused` with why.

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function back(applicationId: string, query: Record<string, string>): never {
  const params = new URLSearchParams({ ...query, n: Date.now().toString(36) });
  redirect(
    `${adminAdoptionApplicationPath(applicationId)}?${params.toString()}`,
    RedirectType.replace
  );
}

type Move = "start_review" | "put_in_contact" | "adopted" | "end";

export async function moveApplicationAction(
  applicationId: string,
  formData: FormData
) {
  const actor = await signedIn();
  const move = text(formData, "move") as Move;
  const path = adminAdoptionApplicationPath(applicationId);
  const outcome = await adminCall(() => {
    const app = as(actor);
    switch (move) {
      case "start_review":
        return app.startAdoptionReview({ applicationId });
      case "put_in_contact":
        return app.putAdopterInContact({ applicationId });
      case "adopted":
        return app.recordAdoptionOutcome({ applicationId, outcome: "adopted" });
      default:
        return app.recordAdoptionOutcome({
          applicationId,
          outcome:
            text(formData, "outcome") === "declined"
              ? "declined"
              : "not_matched",
          reason: text(formData, "reason"),
        });
    }
  }, path);
  if (!outcome.ok) back(applicationId, { refused: "forbidden" });
  const result = outcome.value;
  if (!result.ok) back(applicationId, { refused: result.error });
  if (result.status === "adopted") {
    // The animal leaves browse, and its page says it was adopted.
    updateTag(ADOPTION_TAGS.all);
    updateTag(ADOPTION_TAGS.animal(result.slug));
  }
  back(applicationId, { done: result.status });
}

export async function publishStoryAction(applicationId: string) {
  const actor = await signedIn();
  const outcome = await adminCall(
    () => as(actor).publishSuccessStory({ applicationId }),
    adminAdoptionApplicationPath(applicationId)
  );
  if (!outcome.ok) back(applicationId, { refused: "forbidden" });
  const result = outcome.value;
  if (!result.ok) back(applicationId, { refused: result.error });
  updateTag(ADOPTION_TAGS.stories);
  back(applicationId, { done: "published" });
}
