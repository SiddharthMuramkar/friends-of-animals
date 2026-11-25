"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../_lib/boundary";
import { APP_ROUTES } from "@/lib/app-routes";
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};
export async function galleryAction(
  command: "pick" | "edit" | "publish" | "hide" | "restore" | "dismiss",
  id: string,
  form: FormData
) {
  const path =
    command === "dismiss" || form.get("from") === "reports"
      ? APP_ROUTES.adminGalleryReports
      : APP_ROUTES.adminGallery;
  const result = await adminCall(async () => {
    const use = as(await currentActor());
    switch (command) {
      case "pick":
        return use.pickGalleryEntry({ entryId: id });
      case "edit":
        return use.editGalleryItem({
          itemId: id,
          title: text(form, "title"),
          story: text(form, "story"),
          featured: form.get("featured") === "on",
        });
      case "publish":
        return use.publishGalleryItem({ itemId: id });
      case "hide":
        return use.hideGalleryItem({
          itemId: id,
          reason: form.get("from") === "reports" ? "reported" : "moderator",
        });
      case "restore":
        return use.restoreGalleryItem({ itemId: id });
      case "dismiss":
        return use.dismissGalleryReport({ reportId: id });
    }
  }, path);
  redirect(`${path}?result=${result.ok && result.value.ok ? "ok" : "error"}`);
}
