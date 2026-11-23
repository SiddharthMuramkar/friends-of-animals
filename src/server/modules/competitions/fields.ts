// A competition as the admin form writes it (`CompetitionFields`: strings,
// IST datetime-local key dates) and as the module stores it
// (`CompetitionValues`: nulls for gaps, exact instants). `parseFields`
// turns the first into the second, refusing what can't be saved even as a
// draft; `fieldsOf` turns stored values back into the form's.
//
// Loads under plain Node (the seed script): relative imports only.

import { z } from "zod";

import { parseCompetitionCode } from "./domain/code";
import { instantToIstLocal, istLocalToInstant } from "./domain/ist";
import {
  KEY_DATE_KINDS,
  type KeyDateKind,
  type KeyDates,
} from "./domain/key-dates";
import {
  everyCategory,
  isCalendarDate,
  type CategoryInput,
} from "./domain/publish-rules";
import type { AgeGroupInput } from "./domain/age-groups";
import {
  COMPETITION_DEFAULTS,
  DIGITAL_SCOPES,
  DISCIPLINES,
  PARTICIPATIONS,
  type DigitalScope,
  type Discipline,
  type Participation,
  type PhysicalArtwork,
} from "./domain/vocabulary";

/** Every field of the admin form, as it submits them and shows them back. */
export type CompetitionFields = {
  /** Trimmed and upper-cased when saved. */
  code: string;
  name: string;
  /** "" while not written yet. */
  theme: string;
  welfareMessage: string;
  rules: string;
  permittedMaterials: string;
  duration: string;
  participation: Participation | null;
  disciplines: Discipline[];
  ageGroups: AgeGroupInput[];
  categories: CategoryInput[];
  /** YYYY-MM-DD, or "" while not set. */
  ageCutoffDate: string;
  digitalScope: DigitalScope;
  shortlistPerCategory: number;
  schoolPositions: number;
  physicalArtwork: PhysicalArtwork;
  publicDisplay: boolean;
  auctionPermitted: boolean;
  /** IST datetime-local values ("2027-01-15T10:00"); "" or absent: not set. */
  keyDates: Partial<Record<KeyDateKind, string>>;
};

/**
 * A new competition: a code and a name, and any other fields. Missing
 * fields take the product defaults; missing categories are every
 * discipline for every age group.
 */
export type CompetitionInput = Pick<CompetitionFields, "code" | "name"> &
  Partial<Omit<CompetitionFields, "code" | "name">>;

/** What the module stores: gaps are null, key dates exact instants. */
export type CompetitionValues = {
  code: string;
  name: string;
  theme: string | null;
  welfareMessage: string | null;
  rules: string | null;
  permittedMaterials: string | null;
  duration: string | null;
  participation: Participation | null;
  /** In the vocabulary's order. */
  disciplines: Discipline[];
  /** Labels trimmed, in the manager's order. */
  ageGroups: AgeGroupInput[];
  /** By discipline, then age group; `ageGroup` is the group's own label. */
  categories: CategoryInput[];
  ageCutoffDate: string | null;
  digitalScope: DigitalScope;
  shortlistPerCategory: number;
  schoolPositions: number;
  physicalArtwork: PhysicalArtwork;
  publicDisplay: boolean;
  auctionPermitted: boolean;
  keyDates: KeyDates;
};

/**
 * The fields a new competition starts from. No categories: a new
 * competition's are every discipline for every age group.
 */
export const DEFAULT_FIELDS: Omit<
  CompetitionFields,
  "code" | "name" | "categories"
> = {
  theme: "",
  welfareMessage: "",
  rules: "",
  permittedMaterials: "",
  duration: "",
  participation: null,
  disciplines: [],
  ageGroups: [],
  ageCutoffDate: "",
  digitalScope: COMPETITION_DEFAULTS.digitalScope,
  shortlistPerCategory: COMPETITION_DEFAULTS.shortlistPerCategory,
  schoolPositions: COMPETITION_DEFAULTS.schoolPositions,
  physicalArtwork: COMPETITION_DEFAULTS.physicalArtwork,
  publicDisplay: COMPETITION_DEFAULTS.publicDisplay,
  auctionPermitted: COMPETITION_DEFAULTS.auctionPermitted,
  keyDates: {},
};

/** Upper bounds that keep one form from filling the database. */
const LIMITS = {
  code: 40,
  name: 120,
  theme: 300,
  longText: 10_000,
  shortText: 120,
  label: 60,
  ageGroups: 20,
  categories: DISCIPLINES.length * 20,
} as const;

const age = z.int().min(0).max(120);

const fieldsSchema = z.object({
  code: z.string().max(LIMITS.code),
  name: z.string().max(LIMITS.name),
  theme: z.string().max(LIMITS.theme),
  welfareMessage: z.string().max(LIMITS.longText),
  rules: z.string().max(LIMITS.longText),
  permittedMaterials: z.string().max(LIMITS.longText),
  duration: z.string().max(LIMITS.shortText),
  participation: z.enum(PARTICIPATIONS).nullable(),
  disciplines: z.array(z.enum(DISCIPLINES)).max(DISCIPLINES.length),
  ageGroups: z
    .array(
      z.object({
        label: z.string().max(LIMITS.label),
        minAge: age,
        maxAge: age,
      })
    )
    .max(LIMITS.ageGroups),
  categories: z
    .array(
      z.object({
        discipline: z.enum(DISCIPLINES),
        ageGroup: z.string().max(LIMITS.label),
      })
    )
    .max(LIMITS.categories)
    .optional(),
  ageCutoffDate: z.string().max(10),
  digitalScope: z.enum(DIGITAL_SCOPES),
  shortlistPerCategory: z.int().min(0).max(1000),
  schoolPositions: z.int().min(0).max(100),
  physicalArtwork: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("not_required") }),
    z.object({ kind: z.literal("all_shortlisted") }),
    z.object({ kind: z.literal("top_n"), count: z.int().min(1).max(1000) }),
  ]),
  publicDisplay: z.boolean(),
  auctionPermitted: z.boolean(),
  keyDates: z.partialRecord(z.enum(KEY_DATE_KINDS), z.string().max(20)),
});

/** The form's fields to save; no categories means every one. */
export type FieldsToSave = Omit<CompetitionFields, "categories"> & {
  categories?: CategoryInput[];
};

export type FieldsRefusal =
  | { ok: false; error: "invalid_input"; fields: string[] }
  | { ok: false; error: "invalid_code" }
  | { ok: false; error: "invalid_date"; fields: string[] };

const labelKey = (label: string) => label.trim().toLowerCase();

const textOrNull = (text: string) => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * The values to store for these fields, or why they can't be saved even
 * as a draft: a field of the wrong type (`invalid_input`), a code that
 * isn't 3 to 6 letters and a year (`invalid_code`), a blank name, age
 * groups sharing a label, a category naming a discipline or age group the
 * competition doesn't have (`invalid_input`), or a date that doesn't exist
 * (`invalid_date`, naming `ageCutoffDate` or `keyDates.<kind>`). Anything
 * else a draft may lack is for publishing to refuse.
 */
export function parseFields(
  input: FieldsToSave
): { ok: true; values: CompetitionValues } | FieldsRefusal {
  const parsed = fieldsSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return { ok: false, error: "invalid_input", fields: [...fields] };
  }
  const fields = parsed.data;

  const code = parseCompetitionCode(fields.code);
  if (!code.ok) return code;

  const invalid: string[] = [];
  const name = fields.name.trim();
  if (name === "") invalid.push("name");

  const ageGroups = fields.ageGroups.map((group) => ({
    ...group,
    label: group.label.trim(),
  }));
  const labels = ageGroups.map((group) => labelKey(group.label));
  const groupsOk =
    labels.every((label) => label !== "") &&
    new Set(labels).size === labels.length;
  if (!groupsOk) invalid.push("ageGroups");

  const chosen = new Set(fields.disciplines);
  const disciplines = DISCIPLINES.filter((d) => chosen.has(d));
  let categories: CategoryInput[] = [];
  if (groupsOk) {
    const wanted =
      fields.categories ??
      everyCategory(
        disciplines,
        ageGroups.map((group) => group.label)
      );
    const known = wanted.every(
      (c) => chosen.has(c.discipline) && labels.includes(labelKey(c.ageGroup))
    );
    if (known) categories = sortCategories(wanted, disciplines, ageGroups);
    else invalid.push("categories");
  }
  if (invalid.length > 0) {
    return { ok: false, error: "invalid_input", fields: invalid };
  }

  const badDates: string[] = [];
  const ageCutoffDate = textOrNull(fields.ageCutoffDate);
  if (ageCutoffDate !== null && !isCalendarDate(ageCutoffDate)) {
    badDates.push("ageCutoffDate");
  }
  const keyDates: KeyDates = {};
  for (const kind of KEY_DATE_KINDS) {
    const local = fields.keyDates[kind]?.trim() ?? "";
    if (local === "") continue;
    const instant = istLocalToInstant(local);
    if (instant.ok) keyDates[kind] = instant.at;
    else badDates.push(`keyDates.${kind}`);
  }
  if (badDates.length > 0) {
    return { ok: false, error: "invalid_date", fields: badDates };
  }

  return {
    ok: true,
    values: {
      code: code.code,
      name,
      theme: textOrNull(fields.theme),
      welfareMessage: textOrNull(fields.welfareMessage),
      rules: textOrNull(fields.rules),
      permittedMaterials: textOrNull(fields.permittedMaterials),
      duration: textOrNull(fields.duration),
      participation: fields.participation,
      disciplines,
      ageGroups,
      categories,
      ageCutoffDate,
      digitalScope: fields.digitalScope,
      shortlistPerCategory: fields.shortlistPerCategory,
      schoolPositions: fields.schoolPositions,
      physicalArtwork: fields.physicalArtwork,
      publicDisplay: fields.publicDisplay,
      auctionPermitted: fields.auctionPermitted,
      keyDates,
    },
  };
}

/**
 * Categories without repeats, by discipline and then age group, each
 * naming its group by the group's own label.
 */
function sortCategories(
  categories: readonly CategoryInput[],
  disciplines: readonly Discipline[],
  ageGroups: readonly AgeGroupInput[]
): CategoryInput[] {
  const groupIndex = new Map(
    ageGroups.map((group, index) => [labelKey(group.label), index])
  );
  const seen = new Set<string>();
  return categories
    .map((c) => ({
      discipline: c.discipline,
      group: groupIndex.get(labelKey(c.ageGroup))!,
    }))
    .filter(({ discipline, group }) => {
      const key = `${discipline}/${group}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        disciplines.indexOf(a.discipline) - disciplines.indexOf(b.discipline) ||
        a.group - b.group
    )
    .map(({ discipline, group }) => ({
      discipline,
      ageGroup: ageGroups[group]!.label,
    }));
}

/** The form's fields for stored values. */
export function fieldsOf(values: CompetitionValues): CompetitionFields {
  const keyDates: CompetitionFields["keyDates"] = {};
  for (const kind of KEY_DATE_KINDS) {
    const at = values.keyDates[kind];
    if (at) keyDates[kind] = instantToIstLocal(at);
  }
  return {
    code: values.code,
    name: values.name,
    theme: values.theme ?? "",
    welfareMessage: values.welfareMessage ?? "",
    rules: values.rules ?? "",
    permittedMaterials: values.permittedMaterials ?? "",
    duration: values.duration ?? "",
    participation: values.participation,
    disciplines: [...values.disciplines],
    ageGroups: values.ageGroups.map((group) => ({ ...group })),
    categories: values.categories.map((c) => ({ ...c })),
    ageCutoffDate: values.ageCutoffDate ?? "",
    digitalScope: values.digitalScope,
    shortlistPerCategory: values.shortlistPerCategory,
    schoolPositions: values.schoolPositions,
    physicalArtwork: { ...values.physicalArtwork },
    publicDisplay: values.publicDisplay,
    auctionPermitted: values.auctionPermitted,
    keyDates,
  };
}
