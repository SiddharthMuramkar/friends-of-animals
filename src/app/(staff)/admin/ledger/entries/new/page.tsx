import { redirect } from "next/navigation";

import { ADMIN_NEW_LEDGER_ENTRY } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { istDateOf } from "@/server/modules/ledger/domain/period";

import { adminCall } from "../../../_lib/boundary";
import { LedgerFrame } from "../../_components/frame";
import { ManualEntryForm } from "../../_components/manual-form";
import { copy, ledgerMetadata } from "../../_lib/copy";

export const metadata = ledgerMetadata(copy.manual.title);

export default async function Page() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const accounts = await adminCall(
    () => as(actor).listLedgerAccounts(),
    ADMIN_NEW_LEDGER_ENTRY
  );
  return (
    <LedgerFrame title={copy.manual.title} back>
      {accounts.ok ? (
        <ManualEntryForm
          today={istDateOf(new Date())}
          accounts={accounts.value
            .filter(({ isActive }) => isActive)
            .map(({ code, name }) => ({
              value: code,
              label: `${code} ${name}`,
            }))}
        />
      ) : (
        <p>{copy.denied}</p>
      )}
    </LedgerFrame>
  );
}
