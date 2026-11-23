import { getMessages, getTranslations } from "next-intl/server";

import { Disclosure } from "@/components/site/disclosure";
import { SectionHeading } from "@/components/site/heading";
import type { SignedFormsForRegistration } from "@/server/modules/consent-forms/dashboard";
import type { UseCases } from "@/server/app";

import { SignedFormCommand } from "./signed-form-command";
import { SignedFormUpload } from "./signed-form-upload";

type SchoolScope = Parameters<UseCases["listSignedFormsForRegistration"]>[0];

export async function ParticipationDeclaration({
  scope,
  declaredAt,
}: {
  scope: SchoolScope;
  declaredAt: Date | null;
}) {
  const { adminConsentForms: words, common } = await getMessages();
  const { declaration, declared, declareHint, declare } = words.coordinator;
  return (
    <section
      aria-labelledby="participation-declaration"
      className="grid gap-3 rounded-3xl border-2 border-border bg-surface p-5"
    >
      <SectionHeading id="participation-declaration" title={declaration} />
      {declaredAt ? (
        <p>{declared}</p>
      ) : (
        <>
          <p>{declareHint}</p>
          <SignedFormCommand
            command={{ kind: "declare", ...scope }}
            label={declare}
            pendingLabel={words.submitting}
            feedback={{ errors: words.errors, problem: common.callout.danger }}
          />
        </>
      )}
    </section>
  );
}

export async function SignedFormCell({
  scope,
  student,
  studentName,
  offers,
}: {
  scope: SchoolScope;
  student: SignedFormsForRegistration["students"][number];
  studentName: string;
  offers: SignedFormsForRegistration["offers"];
}) {
  const [t, { adminConsentForms: words, common }] = await Promise.all([
    getTranslations("adminConsentForms"),
    getMessages(),
  ]);
  const { form, studentId, canWithdraw, effectiveConsent } = student;
  const feedback = { errors: words.errors, problem: common.callout.danger };
  const { file, limits, uses, submit, uploading } = words.coordinator;
  return (
    <div className="mt-4 grid gap-2 border-t border-border pt-4">
      <p className="font-semibold">{t("coordinator.heading")}</p>
      <p>{form ? t(`status.${form.status}`) : t("coordinator.none")}</p>
      {form?.rejectionReason ? (
        <p>{t(`reasons.${form.rejectionReason}`)}</p>
      ) : null}
      {form?.rejectionNote ? (
        <p className="wrap-anywhere">{form.rejectionNote}</p>
      ) : null}
      {canWithdraw && form ? (
        <SignedFormCommand
          command={{ kind: "withdraw", ...scope, formId: form.id }}
          label={words.coordinator.withdraw}
          accessibleName={t("coordinator.withdrawFor", {
            student: studentName,
          })}
          pendingLabel={words.submitting}
          feedback={feedback}
        />
      ) : student.uploadEligible && offers.length > 0 ? (
        <Disclosure summary={t("coordinator.upload")}>
          <SignedFormUpload
            target={{ ...scope, studentId }}
            offers={offers.map(({ purpose, id, title, version }) => ({
              purpose,
              id,
              label: t(`purposes.${purpose}`),
              versionLabel: t("version", { title, version }),
            }))}
            labels={{
              file,
              limits,
              uses,
              submit,
              uploading,
              accessibleName: t("coordinator.uploadFor", {
                student: studentName,
              }),
            }}
            feedback={feedback}
          />
        </Disclosure>
      ) : null}
      {effectiveConsent.length > 0 ? (
        <div className="grid gap-1">
          <p className="font-semibold">{t("coordinator.effectiveConsent")}</p>
          <dl className="grid gap-1 text-sm">
            {effectiveConsent.map(({ purpose, status }) => (
              <div
                key={purpose}
                className="flex flex-wrap justify-between gap-x-4"
              >
                <dt>{t(`purposes.${purpose}`)}</dt>
                <dd>{t(`coordinator.consentStatus.${status}`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
