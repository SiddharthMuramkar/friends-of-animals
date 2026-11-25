"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { adminAuctionLotPath, ADMIN_AUCTIONS_NEW } from "@/lib/app-routes";
import { parseRupeesToPaise } from "@/server/modules/competitions/domain/fees";
import { istLocalToInstant } from "@/server/modules/competitions/domain/ist";
import { adminCall } from "../../_lib/boundary";

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";
const rupees = (value: FormDataEntryValue | null) => {
  const parsed = parseRupeesToPaise(text(value));
  return parsed.ok ? parsed.paise : -1n;
};
const ist = (value: FormDataEntryValue | null) => {
  const parsed = istLocalToInstant(text(value));
  return parsed.ok ? parsed.at : new Date(NaN);
};

export async function createAuctionLot(form: FormData) {
  const result = await adminCall(
    async () =>
      as(await currentActor()).createLot({
        artworkId: text(form.get("artworkId")),
        story: text(form.get("story")),
        basePricePaise: rupees(form.get("base")),
        reservePricePaise: rupees(form.get("reserve")),
        opensAt: ist(form.get("opensAt")),
        closesAt: ist(form.get("closesAt")),
      }),
    ADMIN_AUCTIONS_NEW
  );
  if (result.ok && result.value.ok)
    redirect(adminAuctionLotPath(result.value.lotId));
  redirect(ADMIN_AUCTIONS_NEW + "?result=error");
}
export async function scheduleAuctionLot(lotId: string) {
  const path = adminAuctionLotPath(lotId);
  const result = await adminCall(
    async () => as(await currentActor()).scheduleLot({ lotId }),
    path
  );
  const outcome = !result.ok
    ? "error"
    : result.value.ok
      ? "ok"
      : result.value.error === "auctions_disabled"
        ? "disabled"
        : "error";
  redirect(path + "?result=" + outcome);
}
export async function cancelAuctionLot(lotId: string, form: FormData) {
  const path = adminAuctionLotPath(lotId);
  const result = await adminCall(
    async () =>
      as(await currentActor()).cancelLot({
        lotId,
        reason: text(form.get("reason")),
      }),
    path
  );
  redirect(path + "?result=" + (result.ok && result.value.ok ? "ok" : "error"));
}
