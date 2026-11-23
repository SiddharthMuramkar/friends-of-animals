import { eq } from "drizzle-orm";

import { authorize, type PolicyContext } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { ledgerAccount, type LedgerAccountRow } from "../../db/schema";
import { uuidv7 } from "../../ids";

import {
  checkAccountChange,
  checkNewCategory,
  type AccountChange,
  type AccountKind,
  type CategoryKind,
  type PublicGroup,
} from "./domain/chart";

type CategoryLabels = {
  publicLabel?: string | null;
  publicGroup?: PublicGroup;
};
export type CreateLedgerAccountInput = CategoryLabels & {
  code: string;
  name: string;
  kind: AccountKind;
};
export type UpdateLedgerAccountInput = CategoryLabels & {
  code: string;
  name?: string;
};

function accountAudit(account: LedgerAccountRow) {
  return {
    accountId: account.id,
    code: account.code,
    kind: account.kind,
    isActive: account.isActive,
    publicGroup: account.publicGroup,
  };
}

/** Shared by the finance use case and the preview seed. */
export async function insertLedgerAccount(
  tx: AppDb,
  ctx: Pick<PolicyContext, "actor" | "clock">,
  account: CreateLedgerAccountInput & {
    kind: CategoryKind;
    publicGroup: PublicGroup;
  },
  actorRole: Role | null
) {
  const now = ctx.clock.now();
  const [created] = await tx
    .insert(ledgerAccount)
    .values({
      ...account,
      id: uuidv7(now),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: ledgerAccount.code })
    .returning();
  if (!created) return { ok: false, error: "code_taken" } as const;
  await recordAudit(tx, ctx, {
    action: "ledger.account_created",
    entity: { type: "ledger_account", id: created.id },
    before: null,
    after: accountAudit(created),
    actorRole,
  });
  return { ok: true, account: created } as const;
}

export async function createLedgerAccount(
  ctx: PolicyContext,
  input: CreateLedgerAccountInput
) {
  const { role } = await authorize(ctx, "ledger.write");
  const { code, kind } = input;
  // Narrow the account kind before assigning its default reporting group.
  if (kind !== "income" && kind !== "expense")
    return { ok: false, error: "kind_not_allowed" } as const;
  const category = checkNewCategory({ code, name: input.name, kind });
  if (!category.ok) return category;
  const publicGroup =
    input.publicGroup ?? (kind === "income" ? "income" : "programs");
  const labels = checkAccountChange(
    { isSystem: false, isActive: true },
    { publicLabel: input.publicLabel, publicGroup }
  );
  if (!labels.ok) return labels;
  return ctx.db.transaction((tx) =>
    insertLedgerAccount(
      tx,
      ctx,
      {
        code,
        kind,
        name: category.name,
        publicLabel: labels.change.publicLabel,
        publicGroup,
      },
      role
    )
  );
}

async function changeLedgerAccount(
  ctx: PolicyContext,
  code: string,
  change: AccountChange,
  action: "ledger.account_updated" | "ledger.account_deactivated"
) {
  const { role } = await authorize(ctx, "ledger.write");
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.code, code))
      .for("update");
    if (!before) return { ok: false, error: "not_found" } as const;
    const checked = checkAccountChange(before, change);
    if (!checked.ok) return checked;
    const { name, isActive, publicLabel, publicGroup } = checked.change;
    if (
      (name === undefined || name === before.name) &&
      (isActive === undefined || isActive === before.isActive) &&
      (publicLabel === undefined || publicLabel === before.publicLabel) &&
      (publicGroup === undefined || publicGroup === before.publicGroup)
    ) {
      return { ok: false, error: "no_change" } as const;
    }

    const [after] = await tx
      .update(ledgerAccount)
      .set({
        name,
        isActive,
        publicLabel,
        publicGroup,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(ledgerAccount.id, before.id))
      .returning();
    if (!after) throw new Error("Locked ledger account disappeared");
    await recordAudit(tx, ctx, {
      action,
      entity: { type: "ledger_account", id: after.id },
      before: accountAudit(before),
      after: {
        ...accountAudit(after),
        changedFields: (
          ["name", "publicLabel", "publicGroup", "isActive"] as const
        ).filter((field) => before[field] !== after[field]),
      },
      actorRole: role,
    });
    return { ok: true, account: after } as const;
  });
}

export function updateLedgerAccount(
  ctx: PolicyContext,
  { code, name, publicLabel, publicGroup }: UpdateLedgerAccountInput
) {
  return changeLedgerAccount(
    ctx,
    code,
    { name, publicLabel, publicGroup },
    "ledger.account_updated"
  );
}

export function deactivateLedgerAccount(
  ctx: PolicyContext,
  { code }: { code: string }
) {
  return changeLedgerAccount(
    ctx,
    code,
    { isActive: false },
    "ledger.account_deactivated"
  );
}
