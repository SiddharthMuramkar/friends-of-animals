"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";
import {
  useActionState,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";

import {
  finishPasskeyAction,
  startPasskeyAction,
  verifyCodeAction,
  type VerifyFormView,
} from "../_lib/actions";

export type VerifyFormLabels = {
  code: { label: string; hint: string };
  verify: string;
  verifying: string;
  usePasskey: string;
  usingPasskey: string;
  or: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const noSubscription = () => () => {};

/** Whether this browser can use passkeys; false while rendering on the server. */
function useWebAuthn(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => browserSupportsWebAuthn(),
    () => false
  );
}

/**
 * Passes the second factor: a code from an authenticator app, or a
 * passkey where the user has one and the browser supports it. Success
 * navigates to `next` (the actions redirect).
 */
export function VerifyForm({
  next,
  hasTotp,
  hasPasskey,
  labels,
}: {
  next: string;
  hasTotp: boolean;
  hasPasskey: boolean;
  labels: VerifyFormLabels;
}) {
  const [codeView, codeAction] = useActionState(verifyCodeAction, {});
  const [passkeyView, setPasskeyView] = useState<VerifyFormView>({});
  const [passkeyPending, startPasskey] = useTransition();
  const webAuthn = useWebAuthn();
  const showPasskey = hasPasskey && webAuthn;
  const alert = passkeyView.alert ?? codeView.alert;

  function verifyWithPasskey() {
    startPasskey(async () => {
      const challenge = await startPasskeyAction();
      if (!challenge.ok) {
        setPasskeyView(challenge);
        return;
      }
      let response = null;
      try {
        response = await startAuthentication({
          optionsJSON: challenge.options,
        });
      } catch {
        // The person cancelled, or the device refused: say so below.
      }
      setPasskeyView(await finishPasskeyAction(response, next));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{alert}</p>
        </FormAlert>
      ) : null}

      {hasTotp ? (
        <form
          action={codeAction}
          // A new try replaces the passkey's message with the code's.
          onSubmit={() => setPasskeyView({})}
          noValidate
          className="flex flex-col gap-6"
        >
          <input type="hidden" name="next" value={next} />
          <TextField
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            label={labels.code.label}
            hint={labels.code.hint}
            error={codeView.codeError}
          />
          <div>
            <SubmitButton pendingLabel={labels.verifying}>
              {labels.verify}
            </SubmitButton>
          </div>
        </form>
      ) : null}

      {showPasskey ? (
        <div className="flex flex-col gap-3">
          {hasTotp ? (
            <p className="font-semibold text-ink-muted">{labels.or}</p>
          ) : null}
          <div>
            <button
              type="button"
              onClick={verifyWithPasskey}
              disabled={passkeyPending}
              className={buttonStyles({
                variant: hasTotp ? "secondary" : "primary",
              })}
            >
              <KeyRound aria-hidden="true" className="size-5 shrink-0" />
              {passkeyPending ? labels.usingPasskey : labels.usePasskey}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
