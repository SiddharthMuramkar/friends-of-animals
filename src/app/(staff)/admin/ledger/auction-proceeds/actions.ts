"use server";
import { redirect } from "next/navigation";
import { ADMIN_AUCTION_PROCEEDS } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { parseCreatorSharePercent } from "@/server/modules/auctions/domain/proceeds";
import { adminCall } from "../../_lib/boundary";
export async function savePolicy(competitionId: string, form: FormData) {
  const share = form.get("share");
  const parsed = parseCreatorSharePercent(
    typeof share === "string" ? share : ""
  );
  if (!parsed.ok) redirect(ADMIN_AUCTION_PROCEEDS + "?result=error");
  const result = await adminCall(
    async () =>
      as(await currentActor()).setAuctionProceedsPolicy({
        competitionId,
        creatorShareBps: parsed.bps,
      }),
    ADMIN_AUCTION_PROCEEDS
  );
  redirect(
    ADMIN_AUCTION_PROCEEDS +
      `?result=${result.ok && result.value.ok ? "ok" : "error"}`
  );
}
