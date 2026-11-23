import { getMessages, getTranslations } from "next-intl/server";

import { Disclosure } from "@/components/site/disclosure";
import { SectionHeading } from "@/components/site/heading";
import type { SignedFormsForRegistration } from "@/server/modules/consent-forms/dashboard";

import { SignedFormCommand } from "./signed-form-command";
import { SignedFormUpload } from "./signed-form-upload";

export async function ParticipationDeclaration({
  registrationId,
  declaredAt,
}: {
  registrationId: string;
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
            command={{ kind: "declare", registrationId }}
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
  registrationId,
  student,
  studentName,
  offers,
}: {
  registrationId: string;
  student: SignedFormsForRegistration["students"][number];
  studentName: string;
  offers: SignedFormsForRegistration["offers"];
}) {
  const [t, { adminConsentForms: words, common }] = await Promise.all([
    getTranslations("adminConsentForms"),
    getMessages(),
  ]);
  const { form, studentId } = student;
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
      {form?.status === "pending_review" ? (
        <SignedFormCommand
          command={{ kind: "withdraw", formId: form.id }}
          label={words.coordinator.withdraw}
          accessibleName={t("coordinator.withdrawFor", {
            student: studentName,
          })}
          pendingLabel={words.submitting}
          feedback={feedback}
        />
      ) : offers.length > 0 ? (
        <Disclosure summary={t("coordinator.upload")}>
          <SignedFormUpload
            registrationId={registrationId}
            studentId={studentId}
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
    </div>
  );
}
