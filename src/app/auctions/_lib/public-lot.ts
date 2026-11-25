import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";

// The proxy checks visibility before streaming a public shell, so a lot
// that is cancelled, withdrawn, hidden or unknown returns a true 404.
// Unlike normal slug lookup, never memoise the current consent.
export async function publicAuctionLot(lotCode: string): Promise<boolean> {
  const { as } = await import("@/server/app");
  return (await as(PUBLIC_READER).getLot({ lotCode })) !== null;
}
