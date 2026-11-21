// The rules for a staff edit to one template (one key, one channel, one
// locale). Each saved change is a new version, so the dispatcher can record
// exactly which wording went out. The variables a template may use are set
// by code and seed data, never by the edit.
//
// SMS and India's DLT rules: operators deliver only text that matches a
// registered template, identified by its DLT template id. Changing the
// wording therefore clears the id (the new text must be registered first),
// unless the edit brings a different id with it. An SMS template without an
// id is never sent; email and in-app cover for it.
//
// Pure: no database, no clock.

import type { MessageChannel } from "./channels";
import { checkTemplate, type TemplateProblem } from "./template";

/** One stored version of a template. */
export type TemplateVersion = {
  channel: MessageChannel;
  /** Email subject or in-app title; always null for SMS. */
  subject: string | null;
  body: string;
  /** The variable names the template may use. */
  variables: readonly string[];
  /** SMS only: the DLT template id the wording is registered under. */
  dltTemplateId: string | null;
  version: number;
};

/** What a staff member submits. */
export type TemplateEdit = {
  subject?: string | null | undefined;
  body: string;
  /** SMS only. Left out keeps the current id; empty or null clears it. */
  dltTemplateId?: string | null | undefined;
};

export type RevisionProblem =
  | ({ field: "subject" | "body" } & TemplateProblem)
  | { field: "subject" | "body"; code: "required" }
  | { field: "subject" | "body"; code: "too_long"; max: number }
  | { field: "subject"; code: "not_allowed" }
  | { field: "dltTemplateId"; code: "invalid" | "not_allowed" };

export type RevisionResult =
  | { ok: true; changed: boolean; next: TemplateVersion }
  | { ok: false; problems: RevisionProblem[] };

/** Email subjects and in-app titles. */
export const SUBJECT_MAX_LENGTH = 120;

/**
 * Body limits per channel. The SMS limit is a default (about six
 * concatenated segments) until DLT registration (HR-14) settles it.
 */
export const BODY_MAX_LENGTH: Record<MessageChannel, number> = {
  email: 10_000,
  sms: 1_000,
  in_app: 1_000,
};

/**
 * DLT template ids are numeric (Indian operators issue 19 digits). Kept
 * loose until the first real registration confirms the format.
 */
const DLT_TEMPLATE_ID = /^[0-9]{6,30}$/;

function normaliseText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function blankToNull(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function textProblems(
  field: "subject" | "body",
  text: string,
  max: number,
  variables: readonly string[]
): RevisionProblem[] {
  if (text === "") return [{ field, code: "required" }];
  const problems: RevisionProblem[] = [];
  if (text.length > max) problems.push({ field, code: "too_long", max });
  for (const problem of checkTemplate(text, variables)) {
    problems.push({ field, ...problem });
  }
  return problems;
}

/**
 * Checks `edit` against `current` and returns the version to store: the
 * next version number when anything changed, `current` itself when
 * nothing did.
 */
export function reviseTemplate(
  current: TemplateVersion,
  edit: TemplateEdit
): RevisionResult {
  const isSms = current.channel === "sms";
  const problems: RevisionProblem[] = [];

  const subject = blankToNull(edit.subject);
  if (isSms) {
    if (subject !== null)
      problems.push({ field: "subject", code: "not_allowed" });
  } else {
    problems.push(
      ...textProblems(
        "subject",
        subject ?? "",
        SUBJECT_MAX_LENGTH,
        current.variables
      )
    );
  }

  const body = normaliseText(edit.body);
  problems.push(
    ...textProblems(
      "body",
      body,
      BODY_MAX_LENGTH[current.channel],
      current.variables
    )
  );

  const givenId = blankToNull(edit.dltTemplateId);
  if (givenId !== null && !isSms) {
    problems.push({ field: "dltTemplateId", code: "not_allowed" });
  } else if (givenId !== null && !DLT_TEMPLATE_ID.test(givenId)) {
    problems.push({ field: "dltTemplateId", code: "invalid" });
  }

  if (problems.length > 0) return { ok: false, problems };

  let dltTemplateId: string | null = null;
  if (isSms) {
    if (body !== current.body) {
      // New wording needs a new registration: keep only a different id.
      dltTemplateId = givenId !== current.dltTemplateId ? givenId : null;
    } else {
      dltTemplateId =
        edit.dltTemplateId === undefined ? current.dltTemplateId : givenId;
    }
  }

  const changed =
    subject !== current.subject ||
    body !== current.body ||
    dltTemplateId !== current.dltTemplateId;
  if (!changed) return { ok: true, changed: false, next: current };
  return {
    ok: true,
    changed: true,
    next: {
      ...current,
      subject,
      body,
      dltTemplateId,
      version: current.version + 1,
    },
  };
}
