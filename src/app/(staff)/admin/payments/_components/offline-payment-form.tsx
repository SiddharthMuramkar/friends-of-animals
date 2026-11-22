"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState } from "react";

import {
  FormAlert,
  inputStyles,
  SubmitButton,
  TextField,
} from "@/components/form";
import { cn } from "@/lib/utils";

import {
  completeProofUploadAction,
  recordOfflinePaymentAction,
  requestProofUploadAction,
} from "../_lib/actions";
import {
  afterRecord,
  offlineEntered,
  offlineStart,
  type OfflineAlert,
  type OfflineFieldErrors,
  type OfflineFormState,
} from "../_lib/form-state";

type FieldError = NonNullable<OfflineFieldErrors[keyof OfflineFieldErrors]>;

export type OfflinePaymentFormLabels = {
  method: {
    legend: string;
    options: Record<"cheque" | "bank_transfer" | "cash", string>;
  };
  reference: { label: string; hint: string };
  amount: { label: string; hint: string };
  receivedOn: { label: string; hint: string };
  proof: { label: string; hint: string };
  submit: string;
  saving: string;
  errors: Record<FieldError, string>;
  alerts: Record<OfflineAlert, string>;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-strong bg-surface px-4 py-2 has-checked:border-link";

const METHODS = ["cheque", "bank_transfer", "cash"] as const;

/**
 * Uploads the proof straight to private storage, as every upload does
 * (#63), then records the payment with it. A form sent without a proof
 * still goes to the server, so every wrong field is marked at once. Every
 * word comes in `labels`.
 */
export function OfflinePaymentForm({
  batchId,
  defaults,
  labels,
}: {
  batchId: string;
  defaults: { amount: string; receivedOn: string };
  labels: OfflinePaymentFormLabels;
}) {
  const [state, formAction] = useActionState(
    async (
      previous: OfflineFormState,
      formData: FormData
    ): Promise<OfflineFormState> => {
      const proof = formData.get("proof");
      formData.delete("proof");
      formData.set("proofFileId", "");
      if (proof instanceof File && proof.size > 0) {
        const entered = offlineEntered(formData);
        try {
          const presigned = await requestProofUploadAction(batchId, {
            contentType: proof.type,
            sizeBytes: proof.size,
          });
          if (!presigned.ok) {
            return afterRecord(
              previous,
              entered,
              presigned.alert === "proof_invalid"
                ? "unexpected"
                : presigned.alert
            );
          }
          const put = await fetch(presigned.uploadUrl, {
            method: "PUT",
            headers: presigned.headers,
            body: proof,
          });
          if (!put.ok) return afterRecord(previous, entered, "upload_failed");
          const taken = await completeProofUploadAction(presigned.fileId);
          if (!taken.ok) return afterRecord(previous, entered, "upload_failed");
          formData.set("proofFileId", presigned.fileId);
        } catch {
          return afterRecord(previous, entered, "upload_failed");
        }
      }
      return recordOfflinePaymentAction(previous, formData);
    },
    offlineStart(defaults)
  );
  const { entered, errors } = state;
  const proofMissing = state.alert === "proof_invalid";
  const error = (field: keyof OfflineFieldErrors) => {
    const code = errors[field];
    return code ? labels.errors[code] : undefined;
  };

  return (
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="batchId" value={batchId} />
      {state.alert && state.alert !== "proof_invalid" ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{labels.alerts[state.alert]}</p>
        </FormAlert>
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold text-ink">
          {labels.method.legend}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {METHODS.map((method) => (
            <label key={method} className={CHOICE}>
              <input
                type="radio"
                name="method"
                value={method}
                defaultChecked={entered.method === method}
                className="size-5 shrink-0 accent-link"
              />
              <span>{labels.method.options[method]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        id="offline-reference"
        name="reference"
        label={labels.reference.label}
        hint={labels.reference.hint}
        error={error("reference")}
        defaultValue={entered.reference}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
      />
      <TextField
        id="offline-amount"
        name="amount"
        label={labels.amount.label}
        hint={labels.amount.hint}
        error={error("amountMinor")}
        defaultValue={entered.amount}
        inputMode="decimal"
        autoComplete="off"
        maxLength={20}
      />
      <TextField
        id="offline-received-on"
        name="receivedOn"
        type="date"
        label={labels.receivedOn.label}
        hint={labels.receivedOn.hint}
        error={error("receivedOn")}
        defaultValue={entered.receivedOn}
      />
      <div className="flex flex-col gap-2">
        <label htmlFor="offline-proof" className="font-semibold text-ink">
          {labels.proof.label}
        </label>
        <p id="offline-proof-hint" className="text-sm text-ink-muted">
          {labels.proof.hint}
        </p>
        {proofMissing ? (
          <p
            id="offline-proof-error"
            className="flex items-start gap-2 font-semibold text-danger"
          >
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{labels.alerts.proof_invalid}</span>
          </p>
        ) : null}
        <input
          id="offline-proof"
          name="proof"
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          aria-describedby={
            proofMissing
              ? "offline-proof-hint offline-proof-error"
              : "offline-proof-hint"
          }
          aria-invalid={proofMissing ? true : undefined}
          className={cn(
            inputStyles,
            "file:me-4 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:py-1 file:font-semibold file:text-ink"
          )}
        />
      </div>
      <div>
        <SubmitButton variant="primary" pendingLabel={labels.saving}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
