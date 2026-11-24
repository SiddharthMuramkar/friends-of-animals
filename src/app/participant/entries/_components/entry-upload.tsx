import { getFormatter, getTranslations } from "next-intl/server";
import type { ComponentProps } from "react";

import { typeNameKeys } from "@/app/account/files/_lib/upload";
import type { UploadRule } from "@/server/modules/entries/domain/upload-rules";
import type { ImageDiscipline } from "@/server/modules/entries/rules";

import { EntryUploadForm } from "./entry-upload-form";

type Props = Omit<
  ComponentProps<typeof EntryUploadForm>,
  "labels" | "options"
> & {
  options: readonly { value: ImageDiscipline; rule: UploadRule }[];
};

export async function EntryUpload({ options, ...props }: Props) {
  const [form, errors, typeName, disciplineName, format] = await Promise.all([
    getTranslations("entries.form"),
    getTranslations("entries.errors"),
    getTranslations("files.types"),
    getTranslations("adminCompetitions.vocabulary.discipline"),
    getFormatter(),
  ]);

  return (
    <EntryUploadForm
      {...props}
      options={options.map(({ value, rule }) => ({
        value,
        rule,
        label: disciplineName(value),
        hint: form("limit", {
          types: format.list(
            typeNameKeys(rule.acceptedTypes).map((key) => typeName(key)),
            {
              type: "disjunction",
            }
          ),
          size: format.number(rule.maxBytes / (1024 * 1024)),
        }),
      }))}
      labels={{
        form: {
          details: form("details"),
          discipline: form("discipline"),
          chooseDiscipline: form("chooseDiscipline"),
          title: form("title"),
          titleRequired: form("titleRequired"),
          description: form("description"),
          descriptionRequired: form("descriptionRequired"),
          statement: form("statement"),
          file: form("file"),
          previewAlt: form("previewAlt"),
          submit: form("submit"),
          replace: form("replace"),
          retry: form("retry"),
          busy: form("busy"),
          problem: form("problem"),
        },
        errors: {
          registration_not_confirmed: errors("registration_not_confirmed"),
          participation_consent_required: errors(
            "participation_consent_required"
          ),
          discipline_not_offered: errors("discipline_not_offered"),
          discipline_required: errors("discipline_required"),
          empty: errors("empty"),
          wrong_type: errors("wrong_type"),
          too_large: errors("too_large"),
          submission_not_open: errors("submission_not_open"),
          deadline_passed: errors("deadline_passed"),
          entry_locked: errors("entry_locked"),
          upload_limit: errors("upload_limit"),
          invalid_input: errors("invalid_input"),
          file_not_found: errors("file_not_found"),
          upload_missing: errors("upload_missing"),
          upload_rejected: errors("upload_rejected"),
          signed_out: errors("signed_out"),
          forbidden: errors("forbidden"),
          storage_unavailable: errors("storage_unavailable"),
          unknown: errors("unknown"),
        },
      }}
    />
  );
}
