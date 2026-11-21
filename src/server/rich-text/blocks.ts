// The rich-text sanitiser for typed blocks. Rich text on this platform is
// never stored or rendered as HTML: it is the block shape of the policy
// pages (src/content/legal/model.ts), paragraphs and lists of text, strong
// text, links and organisation facts, and React renders it as text nodes and
// elements it chooses. Every save and every render passes the value through
// here, so nothing outside a profile reaches the database or the page:
//
//   - markup in any string is stripped (./strip-markup.ts);
//   - a link whose address fails the allowlist (./href.ts) becomes text;
//   - unknown shapes, unknown facts and extra keys are dropped;
//   - empty pieces, blocks and sections are dropped.
//
// It never throws: a bad stored row renders as whatever is safe in it.
// Profiles are data; later tickets add theirs (blog posts add images).
//
// Loads under plain Node (schema, seed): relative imports only.

import {
  LEGAL_FACTS,
  type LegalBlock,
  type LegalFact,
  type LegalInline,
  type LegalSection,
} from "../../content/legal/model";
import { safeHref } from "./href";
import { stripMarkup } from "./strip-markup";

type Profile = {
  /** Organisation facts a document may reference. */
  facts: readonly LegalFact[];
};

const PROFILES = {
  /** CMS pages and policy documents: text, strong, links and facts. */
  cms: { facts: LEGAL_FACTS },
} as const satisfies Record<string, Profile>;

export type RichTextProfile = keyof typeof PROFILES;

/** A policy-style document: the short version, then titled sections. */
export type DocumentBody = {
  short: LegalInline[][];
  sections: LegalSection[];
};

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(fields: Fields, ...keys: string[]): boolean {
  const present = Object.keys(fields);
  return present.length === keys.length && keys.every((k) => k in fields);
}

function text(value: unknown): string {
  return typeof value === "string" ? stripMarkup(value) : "";
}

function inline(value: unknown, profile: Profile): LegalInline | null {
  if (typeof value === "string") return text(value) || null;
  if (!isFields(value)) return null;
  if ("strong" in value) {
    const strong = text(value.strong);
    return strong ? { strong } : null;
  }
  if ("link" in value) {
    const label = text(value.link);
    if (!label) return null;
    const href = typeof value.href === "string" ? safeHref(value.href) : null;
    return href ? { link: label, href } : label;
  }
  if ("fact" in value) {
    const fact = profile.facts.find((known) => known === value.fact);
    return fact ? { fact } : null;
  }
  return null;
}

/** A line of rich text: the safe pieces of `value`, in order. */
export function sanitizeInlines(
  value: unknown,
  profile: RichTextProfile
): LegalInline[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((piece) => inline(piece, PROFILES[profile]))
    .filter((piece) => piece !== null);
}

function block(value: unknown, profile: RichTextProfile): LegalBlock | null {
  if (!isFields(value)) return null;
  if (hasOnlyKeys(value, "p")) {
    const p = sanitizeInlines(value.p, profile);
    return p.length > 0 ? { p } : null;
  }
  if (hasOnlyKeys(value, "list") && Array.isArray(value.list)) {
    const list = value.list
      .map((item) => sanitizeInlines(item, profile))
      .filter((item) => item.length > 0);
    return list.length > 0 ? { list } : null;
  }
  return null;
}

/** Paragraphs and lists: the safe, non-empty blocks of `value`. */
export function sanitizeBlocks(
  value: unknown,
  profile: RichTextProfile
): LegalBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => block(item, profile))
    .filter((item) => item !== null);
}

/** Kebab-case letters and digits, as the policy pages' anchors are. */
function anchorId(raw: unknown, position: number): string {
  const id = (typeof raw === "string" ? stripMarkup(raw) : "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || `section-${position}`;
}

/** A one-line field (a heading, a label): markup stripped, spaces collapsed. */
export function sanitizePlainText(value: unknown): string {
  return text(value).replace(/\s+/g, " ").trim();
}

/**
 * A policy-style document. Sections need a title and at least one block;
 * anchor ids are made kebab-case and unique.
 */
export function sanitizeDocumentBody(
  value: unknown,
  profile: RichTextProfile
): DocumentBody {
  if (!isFields(value)) return { short: [], sections: [] };
  const short = Array.isArray(value.short)
    ? value.short
        .map((line) => sanitizeInlines(line, profile))
        .filter((line) => line.length > 0)
    : [];
  const used = new Set<string>();
  const sections: LegalSection[] = [];
  const rawSections = Array.isArray(value.sections) ? value.sections : [];
  for (const raw of rawSections) {
    if (!isFields(raw)) continue;
    const title = sanitizePlainText(raw.title);
    const blocks = sanitizeBlocks(raw.blocks, profile);
    if (!title || blocks.length === 0) continue;
    const base = anchorId(raw.id, sections.length + 1);
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    sections.push({ id, title, blocks });
  }
  return { short, sections };
}
