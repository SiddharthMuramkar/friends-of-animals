"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { APP_ROUTES } from "@/lib/app-routes";
import { adminCall } from "../_lib/boundary";

export async function socialExportAction(
  command: "queue" | "retry" | "edit" | "post",
  id: string,
  form: FormData
) {
  const path = APP_ROUTES.adminSocialExport;
  const result = await adminCall(async () => {
    const use = as(await currentActor());
    switch (command) {
      case "queue":
        return use.queueSocialExport({ itemId: id });
      case "retry":
        return use.requestSocialExportStamp({ exportId: id });
      case "edit": {
        const value = form.get("caption");
        return use.editSocialCaption({
          exportId: id,
          caption: typeof value === "string" ? value : "",
        });
      }
      case "post":
        return use.markSocialExportPosted({ exportId: id });
    }
  }, path);
  redirect(`${path}?result=${result.ok && result.value.ok ? "ok" : "error"}`);
}
