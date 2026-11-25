"use client";

import { useActionState, useState } from "react";

import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import type { PublicGroup } from "@/server/modules/ledger/domain/chart";

import { createCategoryAction, editCategoryAction } from "../_lib/actions";
import { initialFormState, type LedgerFormState } from "../_lib/form-state";
import { LedgerFormFeedback, type LedgerFeedbackLabels } from "./form-feedback";

type Option = { value: string; label: string };
type CategoryField = "code" | "kind" | "name" | "publicLabel" | "publicGroup";

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
    publicLabelHint: string;
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
  const [draft, setDraft] = useState<Partial<Record<CategoryField, string>>>(
    {}
  );
  const [state, action, pending] = useActionState<LedgerFormState, FormData>(
    async (previous, data) => {
      const result = await submit(previous, data);
      if (result.saved) setDraft({});
      return result;
    },
    initialFormState
  );
  const id = `category-${account?.code ?? "new"}`;
  const error = state.error ? t.feedback.errors[state.error] : undefined;

  function updateField(field: CategoryField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <form
      action={action}
      // The draft controls resets so a refused submission keeps its selects.
      onReset={(event) => event.preventDefault()}
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
              value={draft.code ?? ""}
              onChange={(event) => updateField("code", event.target.value)}
              hint={t.codeHint}
              error={
                state.error === "invalid_code" ||
                state.error === "code_out_of_range" ||
                state.error === "code_taken"
                  ? error
                  : undefined
              }
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
            />
            <SelectField
              id={`${id}-kind`}
              name="kind"
              label={t.kind}
              value={draft.kind ?? ""}
              onChange={(event) => updateField("kind", event.target.value)}
              options={t.kinds}
              placeholder={t.chooseKind}
              error={state.error === "kind_not_allowed" ? error : undefined}
              required
            />
          </>
        )}
        <TextField
          id={`${id}-name`}
          name="name"
          label={t.name}
          error={state.error === "invalid_name" ? error : undefined}
          value={draft.name ?? account?.name ?? ""}
          onChange={(event) => updateField("name", event.target.value)}
          maxLength={80}
          required
        />
        <TextField
          id={`${id}-label`}
          name="publicLabel"
          label={t.publicLabel}
          hint={t.publicLabelHint}
          error={state.error === "invalid_public_label" ? error : undefined}
          value={draft.publicLabel ?? account?.publicLabel ?? ""}
          onChange={(event) => updateField("publicLabel", event.target.value)}
          maxLength={80}
        />
        <SelectField
          id={`${id}-group`}
          name="publicGroup"
          label={t.publicGroup}
          options={t.groups}
          placeholder={t.chooseGroup}
          error={state.error === "invalid_public_group" ? error : undefined}
          value={draft.publicGroup ?? account?.publicGroup ?? ""}
          onChange={(event) => updateField("publicGroup", event.target.value)}
          required
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton
          pendingLabel={t.saving}
          name={account ? "intent" : undefined}
          value={account ? "save" : undefined}
        >
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
