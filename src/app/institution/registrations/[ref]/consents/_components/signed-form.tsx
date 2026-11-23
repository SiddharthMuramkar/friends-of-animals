import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("adminConsentForms.coordinator");
  return (
    <section
      aria-labelledby="participation-declaration"
      className="grid gap-3 rounded-3xl border-2 border-border bg-surface p-5"
    >
      <SectionHeading id="participation-declaration" title={t("declaration")} />
      {declaredAt ? (
        <p>{t("declared")}</p>
      ) : (
        <>
          <p>{t("declareHint")}</p>
          <SignedFormCommand command={{ kind: "declare", registrationId }} />
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
  const t = await getTranslations("adminConsentForms");
  const { form, studentId } = student;
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
          studentName={studentName}
        />
      ) : offers.length > 0 ? (
        <Disclosure summary={t("coordinator.upload")}>
          <SignedFormUpload
            registrationId={registrationId}
            studentId={studentId}
            studentName={studentName}
            offers={offers}
          />
        </Disclosure>
      ) : null}
    </div>
  );
}
