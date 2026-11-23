import { redirect } from "next/navigation";

import { SectionHeading } from "@/components/site/heading";
import { ADMIN_LEDGER_ACCOUNTS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { adminCall } from "../../_lib/boundary";
import { CategoryForm } from "../_components/category-form";
import { LedgerFrame } from "../_components/frame";
import { copy, ledgerMetadata } from "../_lib/copy";

const t = copy.accounts;
export const metadata = ledgerMetadata(t.title);
const card = "rounded-3xl border-2 border-border bg-surface p-5 sm:p-6";

export default async function Page() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const accounts = await adminCall(
    () => as(actor).listLedgerAccounts(),
    ADMIN_LEDGER_ACCOUNTS
  );
  if (!accounts.ok)
    return (
      <LedgerFrame title={t.title} back>
        <p>{copy.denied}</p>
      </LedgerFrame>
    );

  return (
    <LedgerFrame title={t.title} back>
      <section className={card} aria-labelledby="create-category">
        <SectionHeading id="create-category" title={t.createTitle} />
        <CategoryForm headingId="create-category" />
      </section>
      <ul className="space-y-4">
        {accounts.value.map((account) => {
          if (account.kind !== "income" && account.kind !== "expense")
            return null;
          const id = `account-${account.code}`;
          return (
            <li key={account.code} className={card}>
              <SectionHeading id={id} title={account.name} />
              <p className="mt-2 text-ink-muted">
                {account.code} · {copy.kinds[account.kind]}
                {account.isSystem ? ` · ${t.system}` : ""}
                {account.isActive ? "" : ` · ${t.inactive}`}
              </p>
              {account.isSystem ? null : (
                <CategoryForm account={account} headingId={id} />
              )}
            </li>
          );
        })}
      </ul>
    </LedgerFrame>
  );
}
