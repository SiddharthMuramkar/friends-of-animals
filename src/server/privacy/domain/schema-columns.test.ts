import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { schemaColumns } from "./schema-columns";

const colour = pgEnum("colour", ["red", "blue"]);

const pet = pgTable("pet", {
  id: uuid().primaryKey(),
  ownerName: text("owner_name").notNull(),
  colour: colour(),
  adoptedAt: timestamp("adopted_at", { withTimezone: true }),
});

const shelter = pgTable("shelter", {
  id: uuid().primaryKey(),
  city: text().notNull(),
});

describe("schemaColumns", () => {
  it("lists every column of every table by its SQL name", () => {
    expect(schemaColumns({ pet, shelter })).toEqual([
      { table: "pet", column: "adopted_at", notNull: false },
      { table: "pet", column: "colour", notNull: false },
      { table: "pet", column: "id", notNull: true },
      { table: "pet", column: "owner_name", notNull: true },
      { table: "shelter", column: "city", notNull: true },
      { table: "shelter", column: "id", notNull: true },
    ]);
  });

  it("skips what isn't a table: enums, types and helpers", () => {
    const columns = schemaColumns({
      colour,
      shelter,
      SHELTER_LIMIT: 5,
      describe: () => "shelter",
    });
    expect(columns.map((column) => column.table)).toEqual([
      "shelter",
      "shelter",
    ]);
  });

  it("lists a table once when the barrel exports it twice", () => {
    expect(schemaColumns({ shelter, shelterAlias: shelter })).toHaveLength(2);
  });
});
