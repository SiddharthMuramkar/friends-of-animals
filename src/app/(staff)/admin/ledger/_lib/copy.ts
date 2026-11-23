import type { Metadata } from "next";

import messages from "../../../../../../messages/en-IN/adminLedger.json";

export const copy = messages.adminLedger;

export function ledgerMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}
