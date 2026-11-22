import { getTranslations } from "next-intl/server";

import {
  cmsDocumentKind,
  type CmsDocumentKey,
} from "@/server/modules/cms/domain/documents";
import { kindOf } from "@/server/modules/cms/kinds";

import {
  type Field,
  type KindForm,
  optionName,
  orderName,
  valuesOf,
} from "../_lib/kind-forms";
import { type EditorField, FieldsEditor } from "./fields-editor";

/** A message key path without its item numbers, and the first as `n`. */
function labelKeyOf(name: string): { key: string; n: number } {
  const parts = name.split(".");
  const number = parts.find((part) => /^\d+$/.test(part));
  return {
    key: parts.filter((part) => !/^\d+$/.test(part)).join("."),
    n: number === undefined ? 1 : Number(number) + 1,
  };
}

/**
 * The form for a home, about, impact or site facts draft, started from
 * the draft, else the published body, else the seed's.
 */
export async function KindEditor({
  documentKey,
  form,
  stored,
}: {
  documentKey: CmsDocumentKey;
  form: KindForm;
  /** The draft's body, else the published one; undefined for neither. */
  stored: unknown;
}) {
  const kind = cmsDocumentKind(documentKey);
  const cmsKind = kindOf(documentKey);
  const body = cmsKind
    ? stored === undefined
      ? cmsKind.seedBody(documentKey)
      : cmsKind.sanitize(stored)
    : null;
  const values = valuesOf(form, body);
  const t = await getTranslations("adminCms");
  // Message paths are built from the body's own paths, so they are typed
  // as plain strings here; adminCms.json holds one for every field.
  const tr = t as unknown as (key: string, values?: { n: number }) => string;

  const optionLabel = (field: Field, value: string): string => {
    if (field.input === "toggles") return tr(`options.sections.${value}`);
    if (field.input === "counts" || field.name.startsWith("counterKeys"))
      return tr(`options.counters.${value}`);
    return value;
  };
  const hintOf = (field: Field): string | undefined => {
    const hints: string[] = [];
    if (
      field.input === "lines" ||
      field.input === "markup" ||
      field.input === "titled" ||
      field.input === "toggles" ||
      field.input === "counts"
    ) {
      hints.push(tr(`editor.fields.hints.${field.input}`));
    }
    if (field.optional) hints.push(t("editor.fields.hints.optional"));
    if (field.maxLength && field.input !== "lines") {
      hints.push(
        t("editor.fields.hints.length", { maxLength: field.maxLength })
      );
    }
    return hints.length > 0 ? hints.join(" ") : undefined;
  };
  const editorField = (field: Field): EditorField => {
    const { key, n } = labelKeyOf(field.name);
    const ordered =
      field.input === "toggles" || field.input === "counts"
        ? String(values[orderName(field)] ?? "")
            .split(",")
            .filter(Boolean)
        : (field.options ?? []);
    return {
      name: field.name,
      input: field.input,
      label: tr(`fields.${kind}.${key}`, { n }),
      hint: hintOf(field),
      maxLength: field.maxLength,
      optional: field.optional,
      options: ordered.map((value) => ({
        value,
        label: optionLabel(field, value),
        name:
          field.input === "toggles" || field.input === "counts"
            ? optionName(field, value)
            : undefined,
      })),
      orderName:
        field.input === "toggles" || field.input === "counts"
          ? orderName(field)
          : undefined,
    };
  };

  return (
    <FieldsEditor
      documentKey={documentKey}
      groups={form.groups.map((group) => ({
        legend: tr(`groups.${kind}.${group.name}`),
        fields: group.fields.map(editorField),
      }))}
      defaultValues={values}
      labels={{
        lead: t("editor.fields.lead"),
        save: t("editor.form.save"),
        saving: t("editor.form.saving"),
        problem: t("editor.form.problem"),
        none: t("editor.fields.none"),
        other: t("editor.fields.other"),
      }}
    />
  );
}
