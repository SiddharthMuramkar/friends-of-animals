"use server";
import { redirect, RedirectType } from "next/navigation";
import { ADMIN_AMBASSADORS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../_lib/boundary";

export async function ambassadorDecisionAction(
  applicationId: string,
  decision: "approve" | "decline",
  formData: FormData
) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const reason = formData.get("reason");
  const outcome = await adminCall(
    () =>
      as(actor).decideAmbassador(
        decision === "approve"
          ? { applicationId, decision }
          : {
              applicationId,
              decision,
              reason: typeof reason === "string" ? reason : "",
            }
      ),
    ADMIN_AMBASSADORS
  );
  const done = !outcome.ok
    ? "forbidden"
    : outcome.value.ok
      ? decision === "approve"
        ? "approved"
        : "declined"
      : outcome.value.error;
  redirect(
    `${ADMIN_AMBASSADORS}?${new URLSearchParams({ done, n: Date.now().toString(36) })}`,
    RedirectType.replace
  );
}
