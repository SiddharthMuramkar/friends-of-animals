// The competition form's fields from what it submits. The form's inputs:
// one per scalar field, `disciplines` and `categories` checkboxes (a
// category's value is "<discipline>:<age group row>"), the age group rows
// as parallel `ageGroup.label|minAge|maxAge` inputs, and one
// `keyDates.<kind>` datetime-local input per key date. Anything malformed
// passes through for the use case to refuse with the field's name.

import type { CompetitionFields } from "@/server/modules/competitions";
import { KEY_DATE_KINDS } from "@/server/modules/competitions/domain/key-dates";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function texts(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

/** A whole number, or NaN for anything else (blank included). */
function whole(value: string): number {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

// The use case checks every enum value; the casts only carry them there.
type Fields = CompetitionFields;

export function fieldsFromForm(form: FormData): CompetitionFields {
  const labels = texts(form, "ageGroup.label");
  const minAges = texts(form, "ageGroup.minAge");
  const maxAges = texts(form, "ageGroup.maxAge");
  const ageGroups = labels.map((label, row) => ({
    label,
    minAge: whole(minAges[row] ?? ""),
    maxAge: whole(maxAges[row] ?? ""),
  }));

  const categories = texts(form, "categories").map((value) => {
    const [discipline = "", row = ""] = value.split(":");
    return {
      discipline: discipline as Fields["disciplines"][number],
      ageGroup: ageGroups[whole(row)]?.label ?? "",
    };
  });

  const keyDates: Fields["keyDates"] = {};
  for (const kind of KEY_DATE_KINDS) {
    const local = text(form, `keyDates.${kind}`).trim();
    if (local !== "") keyDates[kind] = local;
  }

  const physicalKind = text(form, "physicalArtwork");
  const participation = text(form, "participation");

  return {
    code: text(form, "code"),
    name: text(form, "name"),
    theme: text(form, "theme"),
    welfareMessage: text(form, "welfareMessage"),
    rules: text(form, "rules"),
    permittedMaterials: text(form, "permittedMaterials"),
    duration: text(form, "duration"),
    participation:
      participation === ""
        ? null
        : (participation as NonNullable<Fields["participation"]>),
    disciplines: texts(form, "disciplines") as Fields["disciplines"],
    ageGroups,
    categories,
    ageCutoffDate: text(form, "ageCutoffDate"),
    digitalScope: text(form, "digitalScope") as Fields["digitalScope"],
    shortlistPerCategory: whole(text(form, "shortlistPerCategory")),
    schoolPositions: whole(text(form, "schoolPositions")),
    physicalArtwork: (physicalKind === "top_n"
      ? { kind: "top_n", count: whole(text(form, "physicalArtworkTopN")) }
      : { kind: physicalKind }) as Fields["physicalArtwork"],
    publicDisplay: form.get("publicDisplay") !== null,
    auctionPermitted: form.get("auctionPermitted") !== null,
    keyDates,
  };
}
