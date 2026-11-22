"use server";

import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { STUDENT_IMPORT_LIMITS } from "@/server/modules/registration/domain/student-csv";

import { calendarDateInstant } from "../../_lib/student-form-state";
import { type ImportAttempt, type ImportView, importView } from "./import-view";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Imports the uploaded CSV file into the registration and says what
 * happened, translated here so the island ships no message catalogue.
 * Nothing about the students is logged: an unexpected failure logs its
 * error class and Postgres code only.
 */
export async function importStudentsAction(
  _previous: ImportView,
  formData: FormData
): Promise<ImportView> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const institutionId = field(formData, "institutionId");
  const reference = field(formData, "reference");
  const file = formData.get("file");

  const [t, format] = await Promise.all([
    getTranslations("studentImport"),
    getFormatter(),
  ]);
  const words = {
    t: (key: string, values?: Record<string, string | number>) =>
      t(key as Parameters<typeof t>[0], values),
    formatDate: (isoDate: string) =>
      format.dateTime(calendarDateInstant(isoDate), "long"),
  };
  // A browser sends an empty, nameless file when none was chosen.
  if (!(file instanceof File) || (file.size === 0 && file.name === "")) {
    return { step: "refused", alert: t("alert.no_file") };
  }

  let result: ImportAttempt;
  // Too big to read: refused before its bytes are loaded.
  if (file.size > STUDENT_IMPORT_LIMITS.maxBytes) {
    result = {
      ok: false,
      error: "unreadable_file",
      problem: { code: "too_large", maxBytes: STUDENT_IMPORT_LIMITS.maxBytes },
    };
  } else {
    try {
      result = await as(actor).importStudents({
        institutionId,
        reference,
        file: new Uint8Array(await file.arrayBuffer()),
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "forbidden") {
        result = "forbidden";
      } else {
        console.error(`importStudents failed: ${errorSummaryForLogs(error)}`);
        result = undefined;
      }
    }
  }
  return importView(result, words);
}
