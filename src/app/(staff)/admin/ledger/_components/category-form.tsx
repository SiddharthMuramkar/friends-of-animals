"use client";

import { useActionState } from "react";

import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import type { PublicGroup } from "@/server/modules/ledger/domain/chart";

import { createCategoryAction, editCategoryAction } from "../_lib/actions";
import { initialFormState } from "../_lib/form-state";
import { LedgerFormFeedback, type LedgerFeedbackLabels } from "./form-feedback";

type Option = { value: string; label: string };

export function CategoryForm({
  account,
  headingId,
  labels: t,
}: {
  account?: {
    code: string;
    name: string;
    publicLabel: string | null;
    publicGroup: PublicGroup | null;
    isActive: boolean;
  };
  headingId: string;
  labels: {
    code: string;
    codeHint: string;
    kind: string;
    chooseKind: string;
    kinds: Option[];
    name: string;
    publicLabel: string;
    publicGroup: string;
    chooseGroup: string;
    groups: Option[];
    save: string;
    create: string;
    deactivate: string;
    saving: string;
    feedback: LedgerFeedbackLabels;
  };
}) {
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
      <LedgerFormFeedback state={state} labels={t.feedback} />
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
              options={t.kinds}
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
          options={t.groups}
          placeholder={t.chooseGroup}
          defaultValue={account?.publicGroup ?? ""}
          required
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel={t.saving}>
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
