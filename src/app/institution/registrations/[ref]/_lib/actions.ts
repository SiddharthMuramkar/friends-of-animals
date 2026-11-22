"use server";

import { getFormatter, getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { institutionRegistrationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import type {
  EnrolStudentResult,
  StudentInput,
  WithdrawStudentResult,
} from "@/server/modules/registration";

import {
  type Attempt,
  calendarDateInstant,
  enrolFormState,
  STUDENT_FIELDS,
  withdrawOutcome,
  type StudentFormView,
  type StudentsOutcome,
} from "./student-form-state";

/**
 * A use case's error as the page says it: "forbidden" when it refused the
 * actor, such as a coordinator removed since the page loaded; anything
 * else is logged (class and Postgres code only) and says "failed".
 */
function thrown(useCase: string, error: unknown): "forbidden" | undefined {
  if (error instanceof DomainError && error.code === "forbidden") {
    return "forbidden";
  }
  console.error(`${useCase} failed: ${errorSummaryForLogs(error)}`);
  return undefined;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Back to the registration's students, saying what happened. */
function backToStudents(
  reference: string,
  institutionId: string,
  outcome: StudentsOutcome,
  registrationId?: string
): never {
  const query = new URLSearchParams({
    done: outcome,
    // New each time, so a second outcome in a row is announced too.
    n: Date.now().toString(36),
  });
  // An id, never a name: names stay out of URLs and logs.
  if (registrationId) query.set("student", registrationId);
  redirect(
    `${institutionRegistrationPath(reference, institutionId)}&${query.toString()}`,
    RedirectType.replace
  );
}

/**
 * Enrols one student. On success it goes back to the list; otherwise the
 * form keeps what was typed beside the reasons, translated here so the
 * client island ships no message catalogue.
 */
export async function enrolStudentAction(
  _previous: StudentFormView,
  formData: FormData
): Promise<StudentFormView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const reference = field(formData, "reference");
  const values: StudentInput = Object.fromEntries(
    STUDENT_FIELDS.map((name) => [name, field(formData, name)])
  );
  let result: Attempt<EnrolStudentResult>;
  try {
    result = await as(actor).enrolStudent({
      institutionId,
      reference,
      student: values,
    });
  } catch (error) {
    result = thrown("enrolStudent", error);
  }
  const state = enrolFormState(values, result);
  if ("enrolled" in state) {
    backToStudents(
      reference,
      institutionId,
      state.enrolled.ignored ? "enrolledIgnored" : "enrolled",
      state.enrolled.registrationId
    );
  }

  const [t, format] = await Promise.all([
    getTranslations("institutionRegistration.newStudent"),
    getFormatter(),
  ]);
  const { outsideAge } = state;
  const fields = Object.fromEntries(
    Object.entries(state.fields).map(([name, key]) => [
      name,
      key === "outside_age_groups" && outsideAge
        ? t("errors.outside_age_groups", {
            minAge: outsideAge.minAge,
            maxAge: outsideAge.maxAge,
            age: outsideAge.age,
            cutoff: format.dateTime(
              calendarDateInstant(outsideAge.ageCutoffDate),
              "long"
            ),
          })
        : t(`errors.${key}`),
    ])
  );
  return {
    values: state.values,
    text: { alert: t(`alert.${state.alert}`), fields },
  };
}

/** Withdraws one student, then back to the list with what happened. */
export async function withdrawStudentAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const reference = field(formData, "reference");
  let result: Attempt<WithdrawStudentResult>;
  try {
    result = await as(actor).withdrawStudent({
      institutionId,
      reference,
      registrationId: field(formData, "registrationId"),
    });
  } catch (error) {
    result = thrown("withdrawStudent", error);
  }
  backToStudents(reference, institutionId, withdrawOutcome(result));
}
