import { FormAlert } from "@/components/form/form-alert";

import { copy } from "../_lib/copy";
import type { LedgerFormState } from "../_lib/form-state";

export function LedgerFormFeedback({ state }: { state: LedgerFormState }) {
  if (state.error) {
    return (
      <FormAlert tone="danger" label={copy.problem}>
        <p>{copy.errors[state.error]}</p>
      </FormAlert>
    );
  }
  return state.saved ? <output>{copy.saved}</output> : null;
}
