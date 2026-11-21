// Every column the database schema declares (#114), read from the Drizzle
// schema barrel, so the inventory coverage test sees a new column the
// moment a ticket adds it, without anyone remembering to mark it.
//
// No database: it reads the table objects. Loads under plain Node.

import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

export type SchemaColumn = {
  /** The table's SQL name. */
  table: string;
  /** The column's SQL name. */
  column: string;
  notNull: boolean;
};

/**
 * The columns of every table among `schema`'s exports, sorted by table and
 * column. Anything that isn't a table (enums, types, helpers) is skipped.
 */
export function schemaColumns(
  schema: Readonly<Record<string, unknown>>
): SchemaColumn[] {
  const tables = new Set<PgTable>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) tables.add(value);
  }
  const columns: SchemaColumn[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      columns.push({
        table: config.name,
        column: column.name,
        notNull: column.notNull,
      });
    }
  }
  return columns.sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)
  );
}
