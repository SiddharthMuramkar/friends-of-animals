"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";

import {
  revokeLinkAction,
  sendLinkAction,
  suggestContactAction,
} from "../actions";

type Contact = Awaited<ReturnType<typeof suggestContactAction>>;
type Channel = "email" | "sms";

type SendFormLabels = {
  title: string;
  channel: string;
  methods: Record<Channel, string>;
  addresses: Record<Channel, string>;
  submit: string;
  pending: string;
  danger: string;
};

type LinkControlLabels = {
  send: string;
  revoke: string;
  revoking: string;
  sentNotice: string;
  revokedNotice: string;
  dialogTitle: string;
  dialogHint: string;
  loadingContact: string;
  cancel: string;
  form: SendFormLabels;
};

function SendLinkForm({
  institutionId,
  registrationId,
  studentId,
  smsEnabled,
  contact,
  onSent,
  labels,
}: {
  institutionId: string;
  registrationId: string;
  studentId: string;
  smsEnabled: boolean;
  contact: Contact;
  onSent: () => void;
  labels: SendFormLabels;
}) {
  const addressId = useId();
  const addressField = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState<Channel>("email");
  const [state, action] = useActionState(
    sendLinkAction.bind(null, institutionId, registrationId, studentId),
    null
  );
  const invalidAddress = state?.ok === false && state.error === "invalid_input";
  useEffect(() => {
    if (state?.ok) onSent();
    else if (invalidAddress) addressField.current?.focus();
  }, [state, onSent, invalidAddress]);

  return (
    <form
      action={action}
      aria-label={labels.title}
      className="mt-5 flex flex-col gap-4"
    >
      {smsEnabled ? (
        <fieldset>
          <legend className="font-semibold text-ink">{labels.channel}</legend>
          <div className="flex flex-wrap gap-x-5">
            {(["email", "sms"] as const).map((value) => (
              <label
                key={value}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink"
              >
                <input
                  type="radio"
                  name="channel"
                  value={value}
                  checked={channel === value}
                  onChange={() => setChannel(value)}
                />
                {labels.methods[value]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="channel" value="email" />
      )}
      {state && !state.ok ? (
        <FormAlert tone="danger" label={labels.danger}>
          {state.message}
        </FormAlert>
      ) : null}
      <TextField
        ref={addressField}
        key={channel}
        id={addressId}
        name="address"
        label={labels.addresses[channel]}
        type={channel === "email" ? "email" : "tel"}
        autoComplete="off"
        defaultValue={contact?.[channel] ?? ""}
        error={invalidAddress ? state.message : undefined}
        required
      />
      <SubmitButton pendingLabel={labels.pending} className="self-start">
        {labels.submit}
      </SubmitButton>
    </form>
  );
}

export function LinkControls({
  institutionId,
  registrationId,
  studentId,
  canSend,
  smsEnabled,
  revocableLinkId,
  labels,
}: {
  institutionId: string;
  registrationId: string;
  studentId: string;
  canSend: boolean;
  smsEnabled: boolean;
  revocableLinkId: string | null;
  labels: LinkControlLabels;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [contact, setContact] = useState<Contact | undefined>();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [revoke, revokeAction] = useActionState(
    revokeLinkAction.bind(
      null,
      institutionId,
      registrationId,
      revocableLinkId ?? ""
    ),
    null
  );

  const onSent = useCallback(() => {
    setSent(true);
    dialog.current?.close();
  }, []);

  async function showSendDialog() {
    setContact(undefined);
    setSent(false);
    setOpen(true);
    dialog.current?.showModal();
    setContact(
      await suggestContactAction(institutionId, registrationId, studentId)
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {canSend ? (
        <button
          type="button"
          aria-haspopup="dialog"
          className={buttonStyles({ variant: "secondary" })}
          onClick={showSendDialog}
        >
          {labels.send}
        </button>
      ) : null}
      {revocableLinkId ? (
        <form action={revokeAction} aria-label={labels.revoke}>
          <SubmitButton variant="quiet" pendingLabel={labels.revoking}>
            {labels.revoke}
          </SubmitButton>
        </form>
      ) : null}
      {sent ? (
        <output className="text-sm text-ink">{labels.sentNotice}</output>
      ) : null}
      {revoke?.ok ? (
        <output className="text-sm text-ink">{labels.revokedNotice}</output>
      ) : null}
      {revoke && !revoke.ok ? (
        <FormAlert tone="danger" label={labels.form.danger}>
          {revoke.message}
        </FormAlert>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto w-[calc(100%_-_2rem)] max-w-md overflow-auto overscroll-contain rounded-3xl border-2 border-border bg-surface p-5 text-ink shadow-warm backdrop:bg-black/60 sm:p-6"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {labels.dialogTitle}
        </h2>
        <p className="mt-2 text-ink-muted">{labels.dialogHint}</p>
        {open && contact === undefined ? (
          <output className="mt-4">{labels.loadingContact}</output>
        ) : null}
        {open && contact !== undefined ? (
          <SendLinkForm
            institutionId={institutionId}
            registrationId={registrationId}
            studentId={studentId}
            smsEnabled={smsEnabled}
            contact={contact}
            onSent={onSent}
            labels={labels.form}
          />
        ) : null}
        <button
          type="button"
          className={buttonStyles({ variant: "quiet", className: "mt-2" })}
          onClick={() => dialog.current?.close()}
        >
          {labels.cancel}
        </button>
      </dialog>
    </div>
  );
}
