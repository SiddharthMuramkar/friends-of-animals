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
  parsePostingSeq,
  type LineDraft,
} from "@/server/modules/ledger/domain/posting";

import { adminCall } from "../../_lib/boundary";
import type { LedgerErrorCode, LedgerFormState } from "./form-state";

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
  data: FormData
): Promise<LedgerFormState | { postingPath: string }> {
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
  for (const [
    amountLine,
    { accountCode, side, amount, memo },
  ] of form.data.lines.entries()) {
    if (amount.length > 32) return { error: "amount_too_large", amountLine };
    const parsed = parseRupees(amount);
    if (!parsed.ok) {
      const error = {
        not_positive: "non_positive_amount",
        too_large: "amount_too_large",
        invalid_amount: "invalid_amount",
      } as const;
      return { error: error[parsed.error], amountLine };
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
  if (!result.value.ok) {
    const { error } = result.value;
    return { error: error === "invalid_source_type" ? "invalid_input" : error };
  }
  return { postingPath: adminLedgerPostingPath(result.value.seq) };
}

const reversalSequence = z
  .string()
  .refine((value) => parsePostingSeq(value) !== undefined);

export async function reverseEntryAction(
  seq: string,
  _previous: LedgerFormState,
  _data: FormData
): Promise<LedgerFormState> {
  const ledger = await signedInLedger();
  const sequence = reversalSequence.safeParse(seq);
  if (!sequence.success) return { error: "invalid_input" };
  const result = await adminCall(
    () => ledger.reversePosting(sequence.data),
    adminLedgerPostingPath(sequence.data)
  );
  if (!result.ok) return { error: "forbidden" };
  if (!result.value.ok) return { error: result.value.error };
  redirect(adminLedgerPostingPath(result.value.seq), RedirectType.replace);
}

const categoryCode = z
  .string()
  .trim()
  .regex(/^\d{4}$/);
const categoryText = z
  .string()
  .trim()
  .max(80)
  .refine((value) => !value.includes("\u0000"));
const categoryDetails = z.object({
  publicGroup: singleTextField.pipe(z.enum(PUBLIC_GROUPS)),
  name: singleTextField.pipe(categoryText.min(1)),
  publicLabel: z
    .array(categoryText)
    .max(1)
    .transform(([value]) => value || null),
});
const newCategory = categoryDetails.extend({
  code: singleTextField.pipe(categoryCode),
  kind: singleTextField.pipe(z.enum(CATEGORY_KINDS)),
});
const categoryIntent = singleTextField.pipe(z.enum(["save", "deactivate"]));

function readCategoryDetails(data: FormData) {
  return {
    publicGroup: data.getAll("publicGroup"),
    name: data.getAll("name"),
    publicLabel: data.getAll("publicLabel"),
  };
}

const categoryErrors: Partial<Record<PropertyKey, LedgerErrorCode>> = {
  code: "invalid_code",
  name: "invalid_name",
  kind: "kind_not_allowed",
  publicGroup: "invalid_public_group",
  publicLabel: "invalid_public_label",
};

function categoryError(error: z.ZodError): LedgerErrorCode {
  const field = error.issues[0]?.path[0];
  return (
    (field === undefined ? undefined : categoryErrors[field]) ?? "invalid_input"
  );
}

export async function createCategoryAction(
  _previous: LedgerFormState,
  data: FormData
): Promise<LedgerFormState> {
  const ledger = await signedInLedger();
  const form = newCategory.safeParse({
    code: data.getAll("code"),
    kind: data.getAll("kind"),
    ...readCategoryDetails(data),
  });
  if (!form.success) return { error: categoryError(form.error) };
  const result = await adminCall(
    () => ledger.createLedgerAccount(form.data),
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
  const account = categoryCode.safeParse(code);
  if (!account.success) return { error: "invalid_code" };
  const intent = categoryIntent.safeParse(data.getAll("intent"));
  if (!intent.success) return { error: "invalid_input" };
  const result = await adminCall(async () => {
    if (intent.data === "deactivate")
      return ledger.deactivateLedgerAccount({ code: account.data });
    const form = categoryDetails.safeParse(readCategoryDetails(data));
    if (!form.success)
      return { ok: false, error: categoryError(form.error) } as const;
    return ledger.updateLedgerAccount({
      code: account.data,
      ...form.data,
    });
  }, ADMIN_LEDGER_ACCOUNTS);
  if (!result.ok) return { error: "forbidden" };
  if (!result.value.ok) return { error: result.value.error };
  revalidatePath(ADMIN_LEDGER_ACCOUNTS);
  return { saved: true };
}
