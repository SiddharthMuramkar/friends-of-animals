"use client";

import { useTranslations } from "next-intl";
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

function SendLinkForm({
  institutionId,
  registrationId,
  studentId,
  smsEnabled,
  contact,
  onSent,
}: {
  institutionId: string;
  registrationId: string;
  studentId: string;
  smsEnabled: boolean;
  contact: Contact;
  onSent: () => void;
}) {
  const t = useTranslations("coordinatorConsents");
  const common = useTranslations("common.callout");
  const addressId = useId();
  const addressField = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState<"email" | "sms">("email");
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
      aria-label={t("sendTitle")}
      className="mt-5 flex flex-col gap-4"
    >
      {smsEnabled ? (
        <fieldset>
          <legend className="font-semibold text-ink">{t("channel")}</legend>
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
                {t(value)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="channel" value="email" />
      )}
      {state && !state.ok ? (
        <FormAlert tone="danger" label={common("danger")}>
          {t(`errors.${state.error}`)}
        </FormAlert>
      ) : null}
      <TextField
        ref={addressField}
        key={channel}
        id={addressId}
        name="address"
        label={t(channel === "email" ? "emailAddress" : "phoneNumber")}
        type={channel === "email" ? "email" : "tel"}
        autoComplete="off"
        defaultValue={contact?.[channel] ?? ""}
        error={invalidAddress ? t("errors.invalid_input") : undefined}
        required
      />
      <SubmitButton pendingLabel={t("sending")} className="self-start">
        {t("send")}
      </SubmitButton>
    </form>
  );
}

export function LinkControls({
  institutionId,
  registrationId,
  studentId,
  name,
  canSend,
  replaces,
  smsEnabled,
  revocableLinkId,
}: {
  institutionId: string;
  registrationId: string;
  studentId: string;
  name: string;
  canSend: boolean;
  replaces: boolean;
  smsEnabled: boolean;
  revocableLinkId: string | null;
}) {
  const t = useTranslations("coordinatorConsents");
  const common = useTranslations("common.callout");
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
          {t(replaces ? "replace" : "send")}
        </button>
      ) : null}
      {revocableLinkId ? (
        <form action={revokeAction} aria-label={t("revoke")}>
          <SubmitButton variant="quiet" pendingLabel={t("revoking")}>
            {t("revoke")}
          </SubmitButton>
        </form>
      ) : null}
      {sent ? (
        <output className="text-sm text-ink">{t("sentNotice")}</output>
      ) : null}
      {revoke?.ok ? (
        <output className="text-sm text-ink">{t("revokedNotice")}</output>
      ) : null}
      {revoke && !revoke.ok ? (
        <FormAlert tone="danger" label={common("danger")}>
          {t(`errors.${revoke.error}`)}
        </FormAlert>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto w-[calc(100%_-_2rem)] max-w-md overflow-auto overscroll-contain rounded-3xl border-2 border-border bg-surface p-5 text-ink shadow-warm backdrop:bg-black/60 sm:p-6"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {t(replaces ? "replaceTitle" : "sendTitle")}
        </h2>
        <p className="mt-2 text-ink-muted">
          {t(replaces ? "replaceHint" : "sendHint", { student: name })}
        </p>
        {open && contact === undefined ? (
          <output className="mt-4">{t("loadingContact")}</output>
        ) : null}
        {open && contact !== undefined ? (
          <SendLinkForm
            institutionId={institutionId}
            registrationId={registrationId}
            studentId={studentId}
            smsEnabled={smsEnabled}
            contact={contact}
            onSent={onSent}
          />
        ) : null}
        <button
          type="button"
          className={buttonStyles({ variant: "quiet", className: "mt-2" })}
          onClick={() => dialog.current?.close()}
        >
          {t("cancel")}
        </button>
      </dialog>
    </div>
  );
}
