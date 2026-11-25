"use server";

import { redirect } from "next/navigation";
import { auctionLotPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { parseRupeesToPaise } from "@/server/modules/competitions/domain/fees";
import { parseLotCode } from "@/server/modules/auctions/domain/lot-code";

/** Native POST from the lot's form, with the price parsed exactly as paise.
 * Never send the bid amount, user id, or reserve price back in a query. */
export async function bidOnLot(code: string, form: FormData) {
  const lotCode = parseLotCode(code);
  if (!lotCode) redirect("/auctions");
  const path = auctionLotPath(lotCode);
  const actor = await currentActor();
  if (actor.kind !== "user")
    redirect(`${ROUTES.signIn.path}?next=${encodeURIComponent(path)}`);
  const value = form.get("amount");
  const amount = parseRupeesToPaise(
    typeof value === "string" && value.length <= 32 ? value : ""
  );
  if (!amount.ok || amount.paise <= 0n) redirect(`${path}?bid=invalid_amount`);
  const version = form.get("declarationVersion");
  const result = await as(actor).placeBid({
    lotCode,
    amountPaise: amount.paise,
    declaredAdult: form.get("adult") === "on",
    declarationVersion: typeof version === "string" ? version : "",
  });
  if (result.ok) redirect(`${path}?bid=accepted`);
  switch (result.error) {
    case "not_found":
    case "auction_consent_missing":
    case "auctions_disabled":
    case "lot_closed":
      redirect("/auctions?bid=unavailable");
    default:
      redirect(`${path}?bid=${result.error}`);
  }
}
