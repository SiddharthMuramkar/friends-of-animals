import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

import { DATA_INVENTORY } from "./inventory";

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table));

const listed = new Set(
  DATA_INVENTORY.map((entry) => `${entry.table}.${entry.column}`)
);

describe("the data inventory", () => {
  it("lists every encrypted column in the schema", () => {
    const encrypted = tables.flatMap((table) =>
      table.columns
        .filter((column) => column.name.endsWith("_ciphertext"))
        .map((column) => `${table.name}.${column.name}`)
    );

    expect(encrypted).toContain("institution.principal_email_ciphertext");
    expect(encrypted.filter((column) => !listed.has(column))).toEqual([]);
  });

  it("lists every personal-data column of an institution", () => {
    expect(
      [
        "principal_name",
        "principal_email_ciphertext",
        "principal_phone_ciphertext",
        "contact_email",
        "contact_phone",
        "created_by",
      ].filter((column) => !listed.has(`institution.${column}`))
    ).toEqual([]);
  });

  it("lists every personal-data column of a coordinator invitation", () => {
    expect(
      [
        "identifier_ciphertext",
        "identifier_hash",
        "token_ciphertext",
        "invited_by_user_id",
        "accepted_by_user_id",
        "revoked_by_user_id",
      ].filter((column) => !listed.has(`institution_invitation.${column}`))
    ).toEqual([]);
  });

  it("names only columns that exist, once each", () => {
    const columns = new Set(
      tables.flatMap((table) =>
        table.columns.map((column) => `${table.name}.${column.name}`)
      )
    );

    expect([...listed].filter((column) => !columns.has(column))).toEqual([]);
    expect(listed.size).toBe(DATA_INVENTORY.length);
  });

  it("gives each entry a purpose and a retention marked to confirm", () => {
    for (const entry of DATA_INVENTORY) {
      expect(entry.purpose.length).toBeGreaterThan(10);
      expect(entry.retention.period.length).toBeGreaterThan(5);
      expect(entry.retention.toConfirm).toBe(true);
    }
  });
});
