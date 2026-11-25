import {
  role,
  signedIn,
  system,
  type Policy,
} from "../../access/domain/policy";
export const AUCTIONS_POLICY = {
  "auction.lot.manage": role("auction_manager"),
  "auction.lot.admin": role("auction_manager"),
  "auction.bid.place": signedIn,
  "auction.lot.run": system("worker"),
  "auction.lot.read_image": () => ({ allowed: true, role: null }),
} satisfies Policy<string>;
