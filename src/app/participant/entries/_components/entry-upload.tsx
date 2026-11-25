import { getFormatter, getTranslations } from "next-intl/server";
import type { ComponentProps } from "react";

import { typeNameKeys } from "@/app/account/files/_lib/upload";
import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";
import { DEFAULT_ESSAY_RULE } from "@/server/modules/entries/domain/essay-text";
import type {
  UploadKind,
  UploadRule,
} from "@/server/modules/entries/domain/upload-rules";
import { formatOf } from "@/server/modules/entries/rules";

import {
  EntryUploadForm,
  type FormError,
  type UploadLabels,
} from "./entry-upload-form";

type Props = Omit<
  ComponentProps<typeof EntryUploadForm>,
  "labels" | "options"
> & {
  options: readonly { value: Discipline; rule: UploadRule }[];
};

const KINDS = ["image", "video", "document"] as const satisfies UploadKind[];

/** Errors whose words name the kind of file (#86); the rest are shared. */
const KIND_ERRORS = [
  "empty",
  "wrong_type",
  "too_large",
  "upload_missing",
  "upload_rejected",
  "invalid_input",
  "discipline_required",
  "too_long",
] as const satisfies FormError[];

const SHARED_ERRORS = [
  "shortlist_only",
  "registration_not_confirmed",
  "participation_consent_required",
  "discipline_not_offered",
  "too_many_words",
  "submission_not_open",
  "deadline_passed",
  "entry_locked",
  "upload_limit",
  "file_not_found",
  "signed_out",
  "forbidden",
  "storage_unavailable",
  "unknown",
] as const satisfies FormError[];

export async function EntryUpload({ options, ...props }: Props) {
  const [form, errors, typeName, disciplineName, format] = await Promise.all([
    getTranslations("entries.form"),
    getTranslations("entries.errors"),
    getTranslations("files.types"),
    getTranslations("adminCompetitions.vocabulary.discipline"),
    getFormatter(),
  ]);
  const maxWords = format.number(DEFAULT_ESSAY_RULE.maxWords);

  const errorsFor = (kind: UploadKind) =>
    Object.fromEntries([
      ...SHARED_ERRORS.map((key) => [key, errors(key)]),
      ...KIND_ERRORS.map((key) => [key, errors(`${kind}.${key}`)]),
    ]) as Record<FormError, string>;

  const labels: UploadLabels = {
    form: {
      details: form("details"),
      discipline: form("discipline"),
      chooseDiscipline: form("chooseDiscipline"),
      title: form("title"),
      titleRequired: form("titleRequired"),
      description: form("description"),
      descriptionRequired: form("descriptionRequired"),
      statement: form("statement"),
      previewAlt: form("previewAlt"),
      problem: form("problem"),
      measuring: form("measuring"),
    },
    kinds: Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        {
          file: form(`${kind}.file`),
          submit: form("submit"),
          replace: form(`${kind}.replace`),
          retry: form(`${kind}.retry`),
          busy: form(`${kind}.busy`),
        },
      ])
    ) as UploadLabels["kinds"],
    essay: {
      method: form("essay.method"),
      typed: form("essay.typed"),
      document: form("essay.document"),
      text: form("essay.text"),
      textHint: form("essay.textHint", { max: maxWords }),
      textRequired: form("essay.textRequired"),
      // The form fills in {count} as the participant types.
      count: form("essay.count", { max: maxWords, count: "{count}" }),
      submit: form("submit"),
      replace: form("essay.replace"),
      retry: form("essay.retry"),
      busy: form("essay.busy"),
    },
    errors: Object.fromEntries(
      KINDS.map((kind) => [kind, errorsFor(kind)])
    ) as UploadLabels["errors"],
  };

  return (
    <EntryUploadForm
      {...props}
      options={options.map(({ value, rule }) => {
        const types = format.list(
          typeNameKeys(rule.acceptedTypes).map((key) => typeName(key)),
          { type: "disjunction" }
        );
        const size = format.number(rule.maxBytes / (1024 * 1024));
        return {
          value,
          rule,
          format: formatOf(value) ?? "image",
          label: disciplineName(value),
          hint:
            rule.maxDurationMs === undefined
              ? form("limit", { types, size })
              : form("limitWithLength", {
                  types,
                  size,
                  minutes: format.number(rule.maxDurationMs / 60_000),
                }),
        };
      })}
      labels={labels}
    />
  );
}
