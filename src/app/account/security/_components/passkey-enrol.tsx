"use client";

import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";

import { FormAlert, TextField } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";

import {
  finishPasskeyRegistrationAction,
  startPasskeyRegistrationAction,
  type PasskeyEnrolView,
} from "../_lib/actions";

export type PasskeyEnrolLabels = {
  label: { label: string; hint: string; error: string };
  start: string;
  starting: string;
  unsupported: string;
  failed: string;
  /** common.callout.danger: meaning never by colour alone. */
  problem: string;
};

const noSubscription = () => () => {};

/**
 * Adding a passkey on this device. Only offered where the browser can
 * make one; otherwise it says so, and the authenticator app remains.
 */
export function PasskeyEnrol({
  next,
  labels,
}: {
  next: string;
  labels: PasskeyEnrolLabels;
}) {
  const supported = useSyncExternalStore(
    noSubscription,
    () => browserSupportsWebAuthn(),
    () => null
  );
  const [label, setLabel] = useState("");
  const [view, setView] = useState<PasskeyEnrolView>({});
  const [pending, startTransition] = useTransition();

  // Not known until the page runs in the browser.
  if (supported === null) return null;
  if (!supported) return <p className="text-ink-muted">{labels.unsupported}</p>;

  function addPasskey() {
    if (label.trim() === "" || label.trim().length > 60) {
      setView({ labelError: labels.label.error });
      return;
    }
    startTransition(async () => {
      const options = await startPasskeyRegistrationAction(next);
      let response = null;
      try {
        response = await startRegistration({ optionsJSON: options });
      } catch {
        // Cancelled, or the device refused: said below.
      }
      if (!response) {
        setView({ alert: labels.failed });
        return;
      }
      setView(await finishPasskeyRegistrationAction({ label, response, next }));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {view.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{view.alert}</p>
        </FormAlert>
      ) : null}
      <TextField
        id="passkey-label"
        name="label"
        autoComplete="off"
        required
        maxLength={60}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        label={labels.label.label}
        hint={labels.label.hint}
        error={view.labelError}
      />
      <div>
        <button
          type="button"
          onClick={addPasskey}
          disabled={pending}
          className={buttonStyles({ variant: "secondary" })}
        >
          <KeyRound aria-hidden="true" />
          {pending ? labels.starting : labels.start}
        </button>
      </div>
    </div>
  );
}
