"use client";

import { OctagonAlert } from "lucide-react";
import { useActionState, useId, type ReactNode } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import type { StudentField } from "@/server/modules/registration";

import { enrolStudentAction } from "../../../_lib/actions";
import { START_STUDENT_FORM } from "../../../_lib/student-form-state";

type FieldLabels = { label: string; hint?: string };

export type StudentFormLabels = {
  student: string;
  fullName: FieldLabels;
  dateOfBirth: FieldLabels;
  grade: FieldLabels;
  studentRef: FieldLabels;
  guardian: { title: string; hint: string };
  guardianName: FieldLabels;
  guardianRelationship: {
    legend: string;
    parent: string;
    legal_guardian: string;
  };
  guardianPhone: FieldLabels;
  guardianEmail: FieldLabels;
  self: { title: string; hint: string };
  phone: FieldLabels;
  email: FieldLabels;
  location: { title: string; hint: string };
  address: FieldLabels;
  pinCode: FieldLabels;
  city: FieldLabels;
  state: FieldLabels;
  submit: string;
  submitting: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
};

const RELATIONSHIPS = ["parent", "legal_guardian"] as const;
const CHOICE = "flex min-h-11 items-center gap-3 text-ink";
const BOX = "size-5 shrink-0 accent-primary";

/**
 * One student's details. Every message comes translated from the action;
 * static words come in `labels`. A student under 18 needs the parent or
 * guardian section, one 18 or over their own contact: the server decides
 * from the date of birth, and drops what the student doesn't need.
 */
export function StudentForm({
  institutionId,
  reference,
  labels,
}: {
  institutionId: string;
  reference: string;
  labels: StudentFormLabels;
}) {
  const [view, formAction] = useActionState(
    enrolStudentAction,
    START_STUDENT_FORM
  );
  const { values, text } = view;
  const field = (
    name: Exclude<StudentField, "guardianRelationship">,
    extra: {
      type?: string;
      autoComplete?: string;
      inputMode?: "tel" | "email";
    } = {}
  ) => (
    <TextField
      id={name}
      name={name}
      type={extra.type ?? "text"}
      autoComplete={extra.autoComplete ?? "off"}
      inputMode={extra.inputMode}
      maxLength={300}
      defaultValue={values[name] ?? ""}
      label={labels[name].label}
      hint={labels[name].hint}
      error={text.fields[name]}
    />
  );
  const relationshipError = text.fields.guardianRelationship;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-8">
      <input type="hidden" name="institutionId" value={institutionId} />
      <input type="hidden" name="reference" value={reference} />
      {text.alert ? (
        <FormAlert tone="danger" label={labels.problem}>
          <p>{text.alert}</p>
        </FormAlert>
      ) : null}

      <Group title={labels.student}>
        {field("fullName", { autoComplete: "off" })}
        {field("dateOfBirth", { type: "date" })}
        {field("grade")}
        {field("studentRef")}
      </Group>

      <Group title={labels.guardian.title} hint={labels.guardian.hint}>
        {field("guardianName")}
        <fieldset
          aria-describedby={
            relationshipError ? "guardianRelationship-error" : undefined
          }
          className="flex flex-col gap-1"
        >
          <legend className="mb-2 font-semibold text-ink">
            {labels.guardianRelationship.legend}
          </legend>
          {relationshipError ? (
            <p
              id="guardianRelationship-error"
              className="flex items-start gap-2 font-semibold text-danger"
            >
              <OctagonAlert
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0"
              />
              <span>{relationshipError}</span>
            </p>
          ) : null}
          {RELATIONSHIPS.map((relationship) => (
            <label key={relationship} className={CHOICE}>
              <input
                type="radio"
                name="guardianRelationship"
                value={relationship}
                defaultChecked={values.guardianRelationship === relationship}
                aria-invalid={relationshipError ? true : undefined}
                className={BOX}
              />
              <span>{labels.guardianRelationship[relationship]}</span>
            </label>
          ))}
        </fieldset>
        {field("guardianPhone", { type: "tel", inputMode: "tel" })}
        {field("guardianEmail", { type: "email", inputMode: "email" })}
      </Group>

      <Group title={labels.self.title} hint={labels.self.hint}>
        {field("phone", { type: "tel", inputMode: "tel" })}
        {field("email", { type: "email", inputMode: "email" })}
      </Group>

      <Group title={labels.location.title} hint={labels.location.hint}>
        {field("address")}
        {field("pinCode", { inputMode: "tel" })}
        {field("city")}
        {field("state")}
      </Group>

      <div>
        <SubmitButton pendingLabel={labels.submitting}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}

/** A titled group of fields, read out with its hint. */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = useId();
  return (
    <fieldset
      aria-describedby={hint ? hintId : undefined}
      className="flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
    >
      <legend className="px-1 text-h3">{title}</legend>
      {hint ? (
        <p id={hintId} className="text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}
