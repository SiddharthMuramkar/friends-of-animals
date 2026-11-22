"use client";

import { useActionState, useId, useState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import type { Messages } from "@/i18n/messages";
import {
  AWARD_BANDS,
  AWARD_SCHEMES,
  MAX_PRIZE_LENGTH,
  type AwardRound,
  type AwardScheme,
} from "@/server/modules/competitions/domain/award-schemes";

import type { AwardsEntered, AwardsFormState } from "../_lib/form-state";

type Copy = Messages["adminCompetitionTerms"];
/** The public words for rounds, schemes and bands (competitionTerms). */
type Words = Messages["competitionTerms"]["awards"];

const CHOICE = "flex min-h-11 items-center gap-3 text-ink";
const RADIO = "size-5 shrink-0 accent-primary";

/** Fills `{name}` placeholders: these labels hold names only. */
function fill(template: string, values: Record<string, string>) {
  return template.replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? ""
  );
}

const isScheme = (value: string): value is AwardScheme =>
  (AWARD_SCHEMES as readonly string[]).includes(value);

/**
 * One round's award scheme and the prize, if any, for each of its places.
 * Choosing another scheme shows its places; prizes for places it lacks
 * are dropped when it saves.
 */
export function RoundAwardsForm({
  action,
  competitionId,
  round,
  initial,
  copy,
  words,
  callout,
}: {
  action: (
    state: AwardsFormState,
    formData: FormData
  ) => Promise<AwardsFormState>;
  competitionId: string;
  round: AwardRound;
  initial: AwardsEntered;
  copy: Pick<Copy, "awards" | "saved" | "unchanged" | "failed">;
  words: Words;
  /** common.callout: meaning never by colour alone. */
  callout: { success: string; danger: string };
}) {
  const [state, formAction] = useActionState(action, { entered: initial });
  const [scheme, setScheme] = useState<AwardScheme>(
    isScheme(state.entered.scheme) ? state.entered.scheme : AWARD_SCHEMES[0]
  );
  const scope = useId();
  const labels = copy.awards;
  const roundName = words.round[round];
  const error =
    state.error === undefined
      ? null
      : state.error === "failed"
        ? copy.failed
        : labels.errors[state.error];

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="roundKey" value={round} />
      {state.outcome ? (
        <FormAlert tone="success" label={callout.success}>
          <p>{copy[state.outcome]}</p>
        </FormAlert>
      ) : null}
      {error ? (
        <FormAlert tone="danger" label={callout.danger}>
          <p>{error}</p>
        </FormAlert>
      ) : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 font-semibold text-ink">{labels.scheme}</legend>
        {AWARD_SCHEMES.map((choice) => (
          <label key={choice} className={CHOICE}>
            <input
              type="radio"
              name="scheme"
              value={choice}
              defaultChecked={state.entered.scheme === choice}
              onChange={() => setScheme(choice)}
              className={RADIO}
            />
            {words.scheme[choice]}
          </label>
        ))}
      </fieldset>
      {AWARD_BANDS[scheme].map((band) => (
        <TextField
          key={band}
          id={`${scope}prize-${band}`}
          name={`prize-${band}`}
          maxLength={MAX_PRIZE_LENGTH}
          autoComplete="off"
          defaultValue={state.entered.prizes[band] ?? ""}
          label={fill(labels.prize, { band: words.band[band] })}
        />
      ))}
      <div>
        <SubmitButton pendingLabel={labels.saving}>
          {fill(labels.save, { round: roundName })}
        </SubmitButton>
      </div>
    </form>
  );
}
