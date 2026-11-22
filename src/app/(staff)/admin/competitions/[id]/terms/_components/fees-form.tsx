"use client";

import { useActionState, useId, useState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import type { Messages } from "@/i18n/messages";
import type { ParticipationRoute } from "@/server/modules/competitions/domain/fees";

import type { FeesEntered, FeesFormState } from "../_lib/form-state";

type Copy = Messages["adminCompetitionTerms"];

const CHOICE = "flex min-h-11 items-center gap-3 text-ink";
const RADIO = "size-5 shrink-0 accent-primary";

/**
 * The fees form: free for everyone, or a fee in rupees for each way the
 * competition takes entries. A refused save comes back with what was
 * typed and a message on each field to fix. Locked once registration has
 * opened: the stored fees show, and nothing can be sent.
 */
export function FeesForm({
  action,
  competitionId,
  routes,
  initial,
  editable,
  copy,
  callout,
}: {
  action: (state: FeesFormState, formData: FormData) => Promise<FeesFormState>;
  competitionId: string;
  /** The routes the competition offers, in order. */
  routes: readonly ParticipationRoute[];
  initial: FeesEntered;
  editable: boolean;
  copy: Pick<Copy, "fees" | "saved" | "unchanged" | "failed">;
  /** common.callout: meaning never by colour alone. */
  callout: { success: string; danger: string };
}) {
  const [state, formAction] = useActionState(action, {
    entered: initial,
    fieldErrors: {},
  });
  const [mode, setMode] = useState(state.entered.mode);
  const scope = useId();
  const labels = copy.fees;
  const alert =
    state.alert === "failed" ? copy.failed : state.alert && labels[state.alert];

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="competitionId" value={competitionId} />
      {state.outcome ? (
        <FormAlert tone="success" label={callout.success}>
          <p>{copy[state.outcome]}</p>
        </FormAlert>
      ) : null}
      {alert ? (
        <FormAlert tone="danger" label={callout.danger}>
          <p>{alert}</p>
        </FormAlert>
      ) : null}
      {editable ? null : <p className="text-ink-muted">{labels.locked}</p>}
      <fieldset disabled={!editable} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 font-semibold text-ink">
            {labels.choice}
          </legend>
          {(["free", "paid"] as const).map((choice) => (
            <label key={choice} className={CHOICE}>
              <input
                type="radio"
                name="mode"
                value={choice}
                defaultChecked={state.entered.mode === choice}
                onChange={() => setMode(choice)}
                className={RADIO}
              />
              {labels[choice]}
            </label>
          ))}
        </fieldset>
        {mode === "paid"
          ? routes.map((route) => {
              const error = state.fieldErrors[route];
              return (
                <TextField
                  key={route}
                  id={`${scope}fee-${route}`}
                  name={`fee-${route}`}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={40}
                  defaultValue={state.entered.fees[route] ?? ""}
                  label={labels.route[route]}
                  error={error && labels.errors[error]}
                />
              );
            })
          : null}
        {editable ? (
          <div>
            <SubmitButton pendingLabel={labels.saving}>
              {labels.save}
            </SubmitButton>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
