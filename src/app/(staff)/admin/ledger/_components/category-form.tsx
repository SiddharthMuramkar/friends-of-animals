"use client";

import { useActionState } from "react";

import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import {
  CATEGORY_KINDS,
  PUBLIC_GROUPS,
  type PublicGroup,
} from "@/server/modules/ledger/domain/chart";

import { createCategoryAction, editCategoryAction } from "../_lib/actions";
import { copy } from "../_lib/copy";
import { initialFormState } from "../_lib/form-state";
import { LedgerFormFeedback } from "./form-feedback";

const kinds = CATEGORY_KINDS.map((kind) => ({
  value: kind,
  label: copy.kinds[kind],
}));
const groups = PUBLIC_GROUPS.map((group) => ({
  value: group,
  label: copy.groups[group],
}));

export function CategoryForm({
  account,
  headingId,
}: {
  account?: {
    code: string;
    name: string;
    publicLabel: string | null;
    publicGroup: PublicGroup | null;
    isActive: boolean;
  };
  headingId: string;
}) {
  const t = copy.accounts;
  const submit = account
    ? editCategoryAction.bind(null, account.code)
    : createCategoryAction;
  const [state, action, pending] = useActionState(submit, initialFormState);
  const id = `category-${account?.code ?? "new"}`;
  return (
    <form
      action={action}
      aria-labelledby={headingId}
      className="mt-4 space-y-4"
    >
      <LedgerFormFeedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        {account ? null : (
          <>
            <TextField
              id={`${id}-code`}
              name="code"
              label={t.code}
              hint={t.codeHint}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
            />
            <SelectField
              id={`${id}-kind`}
              name="kind"
              label={t.kind}
              options={kinds}
              placeholder={t.chooseKind}
              required
            />
          </>
        )}
        <TextField
          id={`${id}-name`}
          name="name"
          label={t.name}
          defaultValue={account?.name}
          maxLength={80}
          required
        />
        <TextField
          id={`${id}-label`}
          name="publicLabel"
          label={t.publicLabel}
          defaultValue={account?.publicLabel ?? ""}
          maxLength={80}
        />
        <SelectField
          id={`${id}-group`}
          name="publicGroup"
          label={t.publicGroup}
          options={groups}
          placeholder={t.chooseGroup}
          defaultValue={account?.publicGroup ?? ""}
          required
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel={copy.saving}>
          {account ? t.save : t.create}
        </SubmitButton>
        {account?.isActive ? (
          <button
            type="submit"
            name="intent"
            value="deactivate"
            formNoValidate
            disabled={pending}
            className={buttonStyles({ variant: "quiet" })}
          >
            {t.deactivate}
          </button>
        ) : null}
      </div>
    </form>
  );
}
