// The CMS editor's form for each kind of document that isn't a policy
// page (#111): home, about, impact and site facts. A form is a list of
// groups of fields named by their path in the body ("hero.heading"), so
// the issues a kind's parse reports ("hero.heading: write some text") land
// beside the field that caused them. `valuesOf` fills the form from a
// body; `bodyFrom` reads a submitted form back into a body, which the
// kind's parse then checks: this module checks nothing the kind checks.
//
// Pure, so every kind's round trip is tested without a page.

import { COUNTER_KEYS } from "@/content/sample/model";
import { SITE_IMAGE_IDS } from "@/lib/images/credits";
import type { CmsDocumentKind } from "@/server/modules/cms/domain/documents";
import { CTA_PATHS, HOME_SECTION_KEYS } from "@/server/modules/cms/kinds/home";
import {
  formatConsentDocumentSource,
  parseConsentDocumentSource,
} from "@/server/modules/consent/domain/document-source";
import type { SourceError } from "@/server/modules/consent";

/** What a form holds: a text per field, or a tick per checkbox. */
export type FormValues = Record<string, string | boolean>;

export type FieldInput =
  /** One line of text. */
  | "text"
  /** A few sentences. */
  | "textarea"
  /** One of `options`; "" for none when the field is optional. */
  | "select"
  /** One item per line. */
  | "lines"
  /** Paragraphs and lists in #64's plain-text markup. */
  | "markup"
  /** Items of a title line and a body, a blank line between items. */
  | "titled"
  | "date"
  /** A tick per option (a home section), kept in the order shown. */
  | "toggles"
  /** A whole number per option (a counter), empty for none. */
  | "counts";

export type Field = {
  /** The field's path in the body, also its form name and label key. */
  name: string;
  input: FieldInput;
  /** For select, toggles and counts. */
  options?: readonly string[];
  maxLength?: number;
  /** May be left empty. */
  optional?: boolean;
};

export type FieldGroup = { name: string; fields: Field[] };

export type KindForm = { groups: FieldGroup[] };

/** A problem with one field before the kind sees the body. */
export type FieldProblem =
  | { kind: "markup"; errors: SourceError[] }
  | { kind: "count" };

export type ReadBody =
  | { ok: true; body: unknown }
  | { ok: false; problems: Record<string, FieldProblem> };

const text = (name: string, maxLength: number, optional = false): Field => ({
  name,
  input: "text",
  maxLength,
  optional,
});
const textarea = (name: string, maxLength: number): Field => ({
  name,
  input: "textarea",
  maxLength,
});

const titledSection = (section: string, body = "body"): Field[] => [
  text(`${section}.eyebrow`, 80),
  text(`${section}.title`, 120),
  textarea(`${section}.${body}`, 600),
];

const FORMS: Record<Exclude<CmsDocumentKind, "legal">, KindForm> = {
  home: {
    groups: [
      {
        name: "hero",
        fields: [
          text("hero.eyebrow", 80),
          text("hero.heading", 120),
          textarea("hero.subheading", 400),
          {
            name: "hero.imageAssetId",
            input: "select",
            options: SITE_IMAGE_IDS,
          },
          text("hero.caption", 120, true),
          text("hero.note", 40, true),
        ],
      },
      {
        name: "buttons",
        fields: [
          text("hero.primaryCta.label", 40),
          { name: "hero.primaryCta.href", input: "select", options: CTA_PATHS },
          text("hero.secondaryCta.label", 40, true),
          {
            name: "hero.secondaryCta.href",
            input: "select",
            options: CTA_PATHS,
            optional: true,
          },
        ],
      },
      {
        name: "counters",
        fields: [0, 1, 2, 3].map((i) => ({
          name: `counterKeys.${i}`,
          input: "select",
          options: COUNTER_KEYS,
        })),
      },
      {
        name: "sections",
        fields: [
          { name: "sections", input: "toggles", options: HOME_SECTION_KEYS },
        ],
      },
    ],
  },
  page: {
    groups: [
      {
        name: "hero",
        fields: [
          text("hero.eyebrow", 80),
          text("hero.title", 120),
          textarea("hero.lead", 600),
          textarea("hero.easy", 300),
        ],
      },
      {
        name: "duty",
        fields: [...titledSection("duty"), textarea("duty.court", 300)],
      },
      {
        name: "vision",
        fields: [
          text("vision.visionTitle", 120),
          textarea("vision.vision", 600),
          text("vision.missionTitle", 120),
          textarea("vision.mission", 600),
        ],
      },
      {
        name: "skill",
        fields: [
          text("skill.eyebrow", 80),
          text("skill.title", 120),
          textarea("skill.easy", 300),
          { name: "skill.body", input: "markup" },
          text("skill.detailSummary", 120),
          { name: "skill.detail", input: "markup" },
        ],
      },
      { name: "ashoka", fields: titledSection("ashoka") },
      {
        name: "how",
        fields: [
          text("how.eyebrow", 80),
          text("how.title", 120),
          ...[0, 1, 2].flatMap((i) => [
            text(`how.steps.${i}.title`, 120),
            textarea(`how.steps.${i}.body`, 600),
          ]),
        ],
      },
      {
        name: "people",
        fields: [
          ...titledSection("people", "lead"),
          { name: "people.items", input: "lines" },
        ],
      },
      {
        name: "objectives",
        fields: [
          text("objectives.eyebrow", 80),
          text("objectives.title", 120),
          { name: "objectives.items", input: "titled" },
        ],
      },
      { name: "transparency", fields: titledSection("transparency") },
      { name: "name", fields: [textarea("name", 600)] },
    ],
  },
  impact: {
    groups: [
      {
        name: "counters",
        fields: [
          { name: "asOf", input: "date" },
          { name: "counters", input: "counts", options: COUNTER_KEYS },
        ],
      },
    ],
  },
  facts: {
    groups: [
      {
        name: "contact",
        fields: [
          text("email", 254, true),
          text("phone", 30, true),
          textarea("address", 300),
          { name: "socials", input: "lines", optional: true },
        ],
      },
      {
        name: "grievance",
        fields: [
          text("grievanceOfficer.name", 120, true),
          text("grievanceOfficer.email", 254, true),
        ],
      },
    ],
  },
};

/** The editor's form for a kind, or null for a policy page's markup. */
export function kindForm(kind: CmsDocumentKind): KindForm | null {
  return kind === "legal" ? null : FORMS[kind];
}

/** The fields of a form, every group's in order. */
export function fieldsOf(form: KindForm): Field[] {
  return form.groups.flatMap((group) => group.fields);
}

/** The form name of one option of a toggles or counts field. */
export function optionName(field: Field, option: string): string {
  return `${field.name}.${option}`;
}

/** The hidden form name holding the order a toggles or counts field shows. */
export function orderName(field: Field): string {
  return `${field.name}.order`;
}

type Path = (string | number)[];

function pathOf(name: string): Path {
  return name
    .split(".")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function getPath(value: unknown, path: Path): unknown {
  let at = value;
  for (const part of path) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string | number, unknown>)[part];
  }
  return at;
}

function setPath(target: Record<string, unknown>, path: Path, value: unknown) {
  let at: Record<string | number, unknown> = target;
  path.forEach((part, i) => {
    if (i === path.length - 1) {
      at[part] = value;
      return;
    }
    const next = path[i + 1];
    at[part] ??= typeof next === "number" ? [] : {};
    at = at[part] as Record<string | number, unknown>;
  });
}

/** Paragraphs and lists as markup: the source of one untitled section. */
export function blocksToMarkup(blocks: unknown): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const source = formatConsentDocumentSource({
    short: [],
    sections: [{ id: "text", title: "Text", blocks }],
  });
  return source.split("\n").slice(1).join("\n").trim();
}

/** Markup as paragraphs and lists, or its errors by line of the field. */
export function markupToBlocks(
  markup: string
): { ok: true; blocks: unknown[] } | { ok: false; errors: SourceError[] } {
  if (markup.trim() === "") return { ok: true, blocks: [] };
  const parsed = parseConsentDocumentSource(`## Text\n${markup}`);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((error) => ({
        ...error,
        line: error.line === null ? null : Math.max(1, error.line - 1),
      })),
    };
  }
  return { ok: true, blocks: parsed.body.sections.flatMap((s) => s.blocks) };
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The options in the order the body lists them, then the rest. */
function orderedOptions(field: Field, listed: unknown): string[] {
  const options = field.options ?? [];
  const keys = Array.isArray(listed)
    ? listed
        .map((item) => (item as { key?: unknown }).key)
        .filter((key): key is string => options.includes(key as string))
    : [];
  return [...new Set([...keys, ...options])];
}

/** The form's values for `body`, field by field. */
export function valuesOf(form: KindForm, body: unknown): FormValues {
  const values: FormValues = {};
  for (const field of fieldsOf(form)) {
    const value = getPath(body, pathOf(field.name));
    switch (field.input) {
      case "lines":
        values[field.name] = Array.isArray(value)
          ? value.map(stringOf).join("\n")
          : "";
        break;
      case "markup":
        values[field.name] = blocksToMarkup(value);
        break;
      case "titled":
        values[field.name] = Array.isArray(value)
          ? value
              .map((item) =>
                [
                  stringOf((item as { title?: unknown }).title),
                  stringOf((item as { body?: unknown }).body),
                ].join("\n")
              )
              .join("\n\n")
          : "";
        break;
      case "toggles": {
        const order = orderedOptions(field, value);
        values[orderName(field)] = order.join(",");
        for (const key of order) {
          const item = Array.isArray(value)
            ? value.find((each) => (each as { key?: unknown }).key === key)
            : undefined;
          values[optionName(field, key)] =
            (item as { visible?: unknown } | undefined)?.visible === true;
        }
        break;
      }
      case "counts": {
        const order = orderedOptions(field, value);
        values[orderName(field)] = order.join(",");
        for (const key of order) {
          const item = Array.isArray(value)
            ? value.find((each) => (each as { key?: unknown }).key === key)
            : undefined;
          const count = (item as { value?: unknown } | undefined)?.value;
          values[optionName(field, key)] =
            typeof count === "number" ? String(count) : "";
        }
        break;
      }
      default:
        values[field.name] = stringOf(value);
    }
  }
  return values;
}

/** Reads a form's text fields; a missing one is empty. */
export type FormReader = (name: string) => string;

/** The order a toggles or counts field showed, limited to its options. */
function submittedOrder(field: Field, read: FormReader): string[] {
  const options = field.options ?? [];
  const listed = read(orderName(field))
    .split(",")
    .filter((key) => options.includes(key));
  return [...new Set([...listed, ...options])];
}

const WHOLE_NUMBER = /^\d+$/;

/**
 * The body a submitted form describes. `checked` says whether a checkbox
 * was ticked. Markup that doesn't parse and counts that aren't whole
 * numbers come back as problems; everything else is for the kind's parse.
 */
export function bodyFrom(
  form: KindForm,
  read: FormReader,
  checked: (name: string) => boolean
): ReadBody {
  const body: Record<string, unknown> = {};
  const problems: Record<string, FieldProblem> = {};
  for (const field of fieldsOf(form)) {
    const path = pathOf(field.name);
    const raw = read(field.name);
    switch (field.input) {
      case "lines":
        setPath(
          body,
          path,
          raw
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        );
        break;
      case "markup": {
        const parsed = markupToBlocks(raw);
        if (parsed.ok) setPath(body, path, parsed.blocks);
        else problems[field.name] = { kind: "markup", errors: parsed.errors };
        break;
      }
      case "titled":
        setPath(
          body,
          path,
          raw
            .split(/\n\s*\n/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
              const [title = "", ...rest] = item.split("\n");
              return { title, body: rest.join(" ") };
            })
        );
        break;
      case "toggles":
        setPath(
          body,
          path,
          submittedOrder(field, read).map((key) => ({
            key,
            visible: checked(optionName(field, key)),
          }))
        );
        break;
      case "counts": {
        const counters: { key: string; value: number }[] = [];
        for (const key of submittedOrder(field, read)) {
          const entered = read(optionName(field, key)).trim();
          if (entered === "") continue;
          if (!WHOLE_NUMBER.test(entered)) {
            problems[optionName(field, key)] = { kind: "count" };
            continue;
          }
          counters.push({ key, value: Number(entered) });
        }
        setPath(body, path, counters);
        break;
      }
      default:
        setPath(body, path, raw);
    }
  }
  // An optional button is left out when both its fields are empty.
  const hero = body.hero as Record<string, unknown> | undefined;
  const secondary = hero?.secondaryCta as
    | { label: string; href: string }
    | undefined;
  if (hero && secondary && !secondary.label.trim() && !secondary.href) {
    delete hero.secondaryCta;
  }
  return Object.keys(problems).length > 0
    ? { ok: false, problems }
    : { ok: true, body };
}

/**
 * The kind's issues ("path: message") by the field they belong to: the
 * longest field name the issue's path starts with, or that starts with the
 * path. Issues no field matches are listed under "".
 */
export function issuesByField(
  form: KindForm,
  issues: readonly string[]
): Record<string, string[]> {
  const names = fieldsOf(form)
    .map((field) => field.name)
    .sort((a, b) => b.length - a.length);
  const grouped: Record<string, string[]> = {};
  for (const issue of issues) {
    const colon = issue.indexOf(": ");
    const path = colon === -1 ? "" : issue.slice(0, colon);
    const message = colon === -1 ? issue : issue.slice(colon + 2);
    const name =
      (path &&
        names.find(
          (candidate) =>
            path === candidate ||
            path.startsWith(`${candidate}.`) ||
            candidate.startsWith(`${path}.`)
        )) ||
      "";
    (grouped[name] ??= []).push(name ? message : issue);
  }
  return grouped;
}
