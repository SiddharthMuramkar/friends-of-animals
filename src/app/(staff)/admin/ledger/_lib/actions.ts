"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import {
  ADMIN_LEDGER_ACCOUNTS,
  ADMIN_NEW_LEDGER_ENTRY,
  adminLedgerPostingPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  CATEGORY_KINDS,
  PUBLIC_GROUPS,
} from "@/server/modules/ledger/domain/chart";
import { parseRupees } from "@/server/modules/ledger/domain/money";
import {
  MAX_LINES,
  type LineDraft,
} from "@/server/modules/ledger/domain/posting";

import { adminCall } from "../../_lib/boundary";
import type { LedgerFormState } from "./form-state";

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

async function signedInLedger() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return as(actor);
}

const singleTextField = z.tuple([z.string()]).transform(([value]) => value);
const manualEntryForm = z.object({
  date: singleTextField,
  description: singleTextField,
  lines: z.array(
    z.object({
      accountCode: z.string(),
      side: z.enum(["debit", "credit"]),
      amount: z.string(),
      memo: z.string(),
    })
  ),
});

export async function createEntryAction(
  _previous: LedgerFormState,
  data: FormData
): Promise<LedgerFormState> {
  const ledger = await signedInLedger();
  const accounts = data.getAll("accountCode");
  const sides = data.getAll("side");
  const amounts = data.getAll("amount");
  const memos = data.getAll("memo");
  if (accounts.length > MAX_LINES) return { error: "too_many_lines" };
  if (
    sides.length !== accounts.length ||
    amounts.length !== accounts.length ||
    memos.length !== accounts.length
  )
    return { error: "invalid_input" };

  const form = manualEntryForm.safeParse({
    date: data.getAll("date"),
    description: data.getAll("description"),
    lines: accounts.map((accountCode, index) => ({
      accountCode,
      side: sides[index],
      amount: amounts[index],
      memo: memos[index],
    })),
  });
  if (!form.success) return { error: "invalid_input" };

  const lines: LineDraft[] = [];
  for (const { accountCode, side, amount, memo } of form.data.lines) {
    if (amount.length > 32) return { error: "amount_too_large" };
    const parsed = parseRupees(amount);
    if (!parsed.ok) {
      const error = {
        not_positive: "non_positive_amount",
        too_large: "amount_too_large",
        invalid_amount: "invalid_amount",
      } as const;
      return { error: error[parsed.error] };
    }
    lines.push({ accountCode, side, amountMinor: parsed.amountMinor, memo });
  }

  const result = await adminCall(
    () =>
      ledger.createManualEntry({
        date: form.data.date,
        description: form.data.description,
        lines,
      }),
    ADMIN_NEW_LEDGER_ENTRY
  );
  if (!result.ok) return { error: "forbidden" };
  if (!result.value.ok) return { error: result.value.error };
  redirect(adminLedgerPostingPath(result.value.seq), RedirectType.replace);
}

export async function reverseEntryAction(
  seq: string,
  _previous: LedgerFormState,
  _data: FormData
): Promise<LedgerFormState> {
  const ledger = await signedInLedger();
  const result = await adminCall(
    () => ledger.reversePosting(seq),
    adminLedgerPostingPath(seq)
  );
  if (!result.ok) return { error: "forbidden" };
  if (!result.value.ok) return { error: result.value.error };
  redirect(adminLedgerPostingPath(result.value.seq), RedirectType.replace);
}

const groups = z.enum(PUBLIC_GROUPS);
const kinds = z.enum(CATEGORY_KINDS);

export async function createCategoryAction(
  _previous: LedgerFormState,
  data: FormData
): Promise<LedgerFormState> {
  const ledger = await signedInLedger();
  const kind = kinds.safeParse(text(data, "kind"));
  const group = groups.safeParse(text(data, "publicGroup"));
  if (!kind.success) return { error: "kind_not_allowed" };
  if (!group.success) return { error: "invalid_public_group" };
  const result = await adminCall(
    () =>
      ledger.createLedgerAccount({
        code: text(data, "code").trim(),
        kind: kind.data,
        name: text(data, "name"),
        publicLabel: text(data, "publicLabel").trim() || null,
        publicGroup: group.data,
      }),
    ADMIN_LEDGER_ACCOUNTS
  );
  if (!result.ok) return { error: "forbidden" };
  if (!result.value.ok) return { error: result.value.error };
  revalidatePath(ADMIN_LEDGER_ACCOUNTS);
  return { saved: true };
}

export async function editCategoryAction(
  code: string,
  _previous: LedgerFormState,
  data: FormData
): Promise<LedgerFormState> {
  const ledger = await signedInLedger();
  const result = await adminCall(async () => {
    if (data.get("intent") === "deactivate")
      return ledger.deactivateLedgerAccount({ code });
    const group = groups.safeParse(text(data, "publicGroup"));
    if (!group.success)
      return { ok: false, error: "invalid_public_group" } as const;
    return ledger.updateLedgerAccount({
      code,
      name: text(data, "name"),
      publicLabel: text(data, "publicLabel").trim() || null,
      publicGroup: group.data,
    });
  }, ADMIN_LEDGER_ACCOUNTS);
  if (!result.ok) return { error: "forbidden" };
  if (!result.value.ok) return { error: result.value.error };
  revalidatePath(ADMIN_LEDGER_ACCOUNTS);
  return { saved: true };
}
