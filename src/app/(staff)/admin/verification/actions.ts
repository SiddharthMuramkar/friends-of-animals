"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import {
  ADMIN_VERIFICATION,
  adminVerificationEntryPath,
} from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function decideVerification(
  entryId: string,
  action: "verify" | "send_back",
  data: FormData
) {
  const actor = await currentActor();
  const app = as(actor);
  const path = adminVerificationEntryPath(entryId);
  const outcome = await adminCall(
    () =>
      action === "verify"
        ? app.verifyEntry({ entryId })
        : app.sendBackEntry({
            entryId,
            reason: {
              code: text(data, "reason"),
              text: text(data, "note"),
            },
          }),
    path
  );
  if (!outcome.ok || !outcome.value.ok) redirect(`${path}?refused=1`);
  redirect(`${ADMIN_VERIFICATION}?done=1`);
}
