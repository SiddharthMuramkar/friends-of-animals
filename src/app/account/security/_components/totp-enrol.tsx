"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";

import { totpEnrolAction, type TotpEnrolView } from "../_lib/actions";

export type TotpEnrolLabels = {
  label: { label: string; hint: string };
  start: string;
  starting: string;
  scan: string;
  qrLabel: string;
  manual: string;
  keyLabel: string;
  code: { label: string; hint: string };
  confirm: string;
  confirming: string;
  cancel: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const START: TotpEnrolView = { step: "label" };

/**
 * Adding an authenticator app: name it, scan the QR code (or type the
 * setup key), then confirm with the app's first code.
 */
export function TotpEnrol({
  next,
  labels,
}: {
  next: string;
  labels: TotpEnrolLabels;
}) {
  const [view, formAction] = useActionState(totpEnrolAction, START);

  return (
    <form
      action={formAction}
      noValidate
      className="@container/totp-enrol flex flex-col gap-6"
    >
      <input type="hidden" name="next" value={next} />
      {view.step === "label" ? (
        <>
          {view.alert ? (
            <FormAlert tone="danger" label={labels.problem}>
              <p>{view.alert}</p>
            </FormAlert>
          ) : null}
          <TextField
            id="totp-label"
            name="label"
            autoComplete="off"
            required
            maxLength={60}
            defaultValue={view.label}
            label={labels.label.label}
            hint={labels.label.hint}
            error={view.labelError}
          />
          <div>
            <SubmitButton
              name="step"
              value="start"
              variant="secondary"
              pendingLabel={labels.starting}
            >
              {labels.start}
            </SubmitButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-start gap-4 @min-[28rem]/totp-enrol:flex-row">
            <svg
              role="img"
              aria-label={labels.qrLabel}
              viewBox={`0 0 ${view.qr.size} ${view.qr.size}`}
              shapeRendering="crispEdges"
              className="aspect-square h-auto w-48 max-w-full shrink-0 rounded-2xl border-2 border-border"
            >
              {/* Dark on light in both themes, as scanners expect. */}
              <rect width={view.qr.size} height={view.qr.size} fill="#fff" />
              <path d={view.qr.path} fill="#000" />
            </svg>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-ink">{labels.scan}</p>
              <p className="text-ink">{labels.manual}</p>
              <p className="text-sm font-semibold text-ink-muted">
                {labels.keyLabel}
              </p>
              <p className="font-mono text-lead tracking-wide text-ink wrap-anywhere">
                {view.key}
              </p>
            </div>
          </div>
          <TextField
            id="totp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            label={labels.code.label}
            hint={labels.code.hint}
            error={view.codeError}
          />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              name="step"
              value="confirm"
              pendingLabel={labels.confirming}
            >
              {labels.confirm}
            </SubmitButton>
            <SubmitButton
              name="step"
              value="restart"
              variant="quiet"
              pendingLabel={labels.cancel}
            >
              {labels.cancel}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
