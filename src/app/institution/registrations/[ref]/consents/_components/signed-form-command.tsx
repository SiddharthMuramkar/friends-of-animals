"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/form";

import { signedFormCommandAction } from "../signed-form-actions";

export function SignedFormCommand({
  command,
  studentName,
}: {
  command: Parameters<typeof signedFormCommandAction>[0];
  studentName?: string;
}) {
  const t = useTranslations("adminConsentForms");
  const callout = useTranslations("common.callout");
  const [state, action] = useActionState(
    signedFormCommandAction.bind(null, command),
    {}
  );
  const label = t(
    command.kind === "declare" ? "coordinator.declare" : "coordinator.withdraw"
  );
  return (
    <form
      action={action}
      aria-label={
        studentName
          ? t("coordinator.withdrawFor", { student: studentName })
          : label
      }
      className="grid justify-items-start gap-3"
    >
      {state.error ? (
        <FormAlert tone="danger" label={callout("danger")}>
          {t(`errors.${state.error}`)}
        </FormAlert>
      ) : null}
      <SubmitButton variant="secondary" pendingLabel={t("submitting")}>
        {label}
      </SubmitButton>
    </form>
  );
}
