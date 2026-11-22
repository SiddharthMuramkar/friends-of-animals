"use client";

import { useActionState } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/form";

import { grantRoleAction } from "../_lib/actions";
import { EMPTY_ROLE_FORM } from "../_lib/form-view";

type Option = { value: string; label: string };

export type GrantFormLabels = {
  role: string;
  scopeType: string;
  scopeId: string;
  scopeIdHint: string;
  choose: string;
  submit: string;
  pending: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

/**
 * Gives the chosen user a role at a scope. A refusal shows here, with the
 * fields at fault marked and what was entered kept; a grant that worked
 * reloads the page with the new role listed.
 */
export function GrantForm({
  userId,
  roles,
  scopes,
  labels,
}: {
  userId: string;
  roles: Option[];
  scopes: Option[];
  labels: GrantFormLabels;
}) {
  const [view, formAction] = useActionState(grantRoleAction, EMPTY_ROLE_FORM);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="userId" value={userId} />
      {view.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.alert}</p>
        </FormAlert>
      ) : null}
      {/* React resets the form once the action returns, and a select goes
          back to the option it mounted with (a text field takes its new
          defaultValue). Keyed on what was entered, a select mounts again
          with it, so a refusal keeps the choice. */}
      <SelectField
        key={`role:${view.values.role}`}
        id="grant-role"
        name="role"
        required
        label={labels.role}
        placeholder={labels.choose}
        options={roles}
        defaultValue={view.values.role}
        error={view.errors.role}
      />
      <SelectField
        key={`scopeType:${view.values.scopeType}`}
        id="grant-scope-type"
        name="scopeType"
        required
        label={labels.scopeType}
        placeholder={labels.choose}
        options={scopes}
        defaultValue={view.values.scopeType}
        error={view.errors.scopeType}
      />
      <TextField
        id="grant-scope-id"
        name="scopeId"
        autoComplete="off"
        spellCheck={false}
        maxLength={36}
        label={labels.scopeId}
        hint={labels.scopeIdHint}
        defaultValue={view.values.scopeId}
        error={view.errors.scopeId}
        className="[&_input]:font-mono"
      />
      <div>
        <SubmitButton pendingLabel={labels.pending}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
