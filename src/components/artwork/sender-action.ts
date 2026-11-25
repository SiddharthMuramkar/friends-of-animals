"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { MY_ARTWORK, INSTITUTION_ARTWORK } from "@/lib/app-routes";
import { orSecondFactor } from "@/app/auth/_lib/refusal";
export async function dispatchArtwork(
  route: "individual" | "institution",
  artworkId: string,
  form: FormData
) {
  const courier = form.get("courier");
  const tracking = form.get("tracking");
  const path = route === "individual" ? MY_ARTWORK : INSTITUTION_ARTWORK;
  const result = await orSecondFactor(
    async () =>
      as(await currentActor()).recordArtworkDispatch({
        artworkIds: [artworkId],
        courierName: typeof courier === "string" ? courier : "",
        trackingNumber: typeof tracking === "string" ? tracking : "",
      }),
    path
  );
  redirect(`${path}?result=${result.ok ? "ok" : "error"}`);
}

export async function requestReturn(
  route: "individual" | "institution",
  artworkId: string
) {
  const path = route === "individual" ? MY_ARTWORK : INSTITUTION_ARTWORK;
  const result = await orSecondFactor(
    async () => as(await currentActor()).requestArtworkReturn({ artworkId }),
    path
  );
  redirect(`${path}?result=${result.ok ? "ok" : "error"}`);
}
