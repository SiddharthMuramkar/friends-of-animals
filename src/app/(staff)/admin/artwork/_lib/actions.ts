"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ADMIN_ARTWORK, adminArtworkPath } from "@/lib/app-routes";
import { adminCall } from "../../_lib/boundary";
export async function requestArtworks(competitionId: string, form: FormData) {
  const packaging = form.get("packaging");
  const path = `${ADMIN_ARTWORK}?competition=${encodeURIComponent(competitionId)}`;
  const result = await adminCall(
    async () =>
      as(await currentActor()).requestPhysicalArtwork({
        competitionId,
        entryIds: form
          .getAll("entry")
          .filter((value): value is string => typeof value === "string"),
        packagingInstructions: typeof packaging === "string" ? packaging : "",
        shippingPayer: form.get("payer") === "foa" ? "foa" : "sender",
      }),
    path
  );
  redirect(`${path}&result=${result.ok && result.value.ok ? "ok" : "error"}`);
}
export async function receiveArtwork(artworkId: string, code: string) {
  const path = adminArtworkPath(code);
  const result = await adminCall(
    async () => as(await currentActor()).markArtworkReceived({ artworkId }),
    path
  );
  redirect(`${path}?result=${result.ok && result.value.ok ? "ok" : "error"}`);
}
