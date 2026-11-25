import { role, system, type Policy } from "../../access/domain/policy";
export const AUCTIONS_POLICY = {
  "auction.lot.manage": role("auction_manager"),
  "auction.lot.admin": role("auction_manager"),
  "auction.lot.run": system("worker"),
} satisfies Policy<string>;
