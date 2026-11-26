"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};
export async function sendGalleryReport(itemId: string, form: FormData) {
  const result = await as(await currentActor()).reportGalleryItem({
    itemId,
    reason: text(form, "reason"),
    details: text(form, "details"),
    contact: text(form, "contact"),
    website: text(form, "website"),
    humanCheck: {
      token: text(form, "humanCheckToken"),
      nonce: Number(text(form, "humanCheckNonce")),
    },
  });
  const outcome = result.ok
    ? "sent"
    : result.error === "rate_limited"
      ? "rate_limited"
      : "invalid";
  redirect(
    `${form.get("plain") === "1" ? `/gallery-report/${encodeURIComponent(itemId)}` : `/gallery/${encodeURIComponent(itemId)}/report`}?result=${outcome}`
  );
}
