import "server-only";

import { ADMIN_LEDGER } from "@/lib/app-routes";
import type { UseCases } from "@/server/app";

import { adminCall } from "./boundary";

export async function showLedgerNavigation(myAccess: UseCases["myAccess"]) {
  const access = await adminCall(myAccess, ADMIN_LEDGER);
  return (
    access.ok && access.value.grants.some(({ role }) => role === "finance")
  );
}
