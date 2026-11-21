import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import type { AdoptionListingStatus, AdoptionMover } from "./domain/status";

export async function transitionAdoptionListing(
  _ctx: { clock: Clock },
  _tx: AppDb,
  _input: { listingId: string; to: AdoptionListingStatus; by: AdoptionMover }
): Promise<{ ok: true } | { ok: false; error: string }> {
  throw new Error("transitionAdoptionListing is not built yet");
}
