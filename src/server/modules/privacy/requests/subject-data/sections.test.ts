// #115b: the export's sections against the data inventory. A table the
// inventory says holds a person's data is exported, referenced, or left out
// with a reason; a ticket that adds such a table fails here until it says
// which.

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { DATA_INVENTORY } from "../../inventory";
import {
  NOT_EXPORTED,
  REFERENCE_COLUMNS,
  SECTIONS,
  sectionName,
  TABLES_BY_NAME,
} from "./sections";

/** Subject kinds that are a person the export can be about. */
const PERSON_KINDS = new Set([
  "user",
  "participant_profile",
  "payer",
  "consent_subject",
  "consent_giver",
  "guardian_contact",
  "donor",
]);

const sectioned = new Set(SECTIONS.map(sectionName));
const referenced = new Set(REFERENCE_COLUMNS.map((each) => each.table));

describe("the export's coverage of the data inventory", () => {
  it("exports, references or explains every table about a person", () => {
    const tables = new Set(
      DATA_INVENTORY.filter((entry) =>
        PERSON_KINDS.has(entry.subject.kind)
      ).map((entry) => entry.table)
    );
    const uncovered = [...tables].filter(
      (table) =>
        !sectioned.has(table) &&
        !referenced.has(table) &&
        !Object.hasOwn(NOT_EXPORTED, table)
    );
    expect(uncovered).toEqual([]);
  });

  it("names only tables that exist, each in one place", () => {
    for (const table of [...sectioned, ...Object.keys(NOT_EXPORTED)]) {
      expect(TABLES_BY_NAME.has(table), table).toBe(true);
    }
    for (const table of sectioned) {
      expect(Object.hasOwn(NOT_EXPORTED, table), table).toBe(false);
    }
    expect(sectioned.size).toBe(SECTIONS.length);
  });

  it("decrypts or leaves out every encrypted column a section reads", () => {
    for (const section of SECTIONS) {
      const name = sectionName(section);
      const columns = Object.values(getTableColumns(section.table)).map(
        (column) => column.name
      );
      for (const listed of [
        ...section.owners,
        ...(section.withhold ?? []),
        ...(section.include ?? []),
        ...Object.keys(section.decrypt ?? {}),
      ]) {
        expect(columns, `${name}.${listed}`).toContain(listed);
      }
      for (const column of columns.filter((each) =>
        each.endsWith("_ciphertext")
      )) {
        const handled =
          Object.hasOwn(section.decrypt ?? {}, column) ||
          (section.withhold ?? []).includes(column) ||
          (section.include !== undefined && !section.include.includes(column));
        expect(handled, `${name}.${column}`).toBe(true);
      }
    }
  });
});
