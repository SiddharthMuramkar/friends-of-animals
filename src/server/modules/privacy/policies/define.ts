// A retention policy over one table with a uuid `id` (#114): the rows it
// covers, the instant each row's period counts from, the subjects a legal
// hold may name, and what happens to an expired row. Deleting removes the
// row; anonymising blanks the columns the data inventory marks for this
// policy (null, or the "[removed]" placeholder), so the inventory stays
// the one list of what expiry clears.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  and,
  asc,
  getTableColumns,
  getTableName,
  gt,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { AppDb } from "../../../db/app-db";
import type { TimedPolicyKey } from "../domain/periods";
import { anonymisePatch, TOMBSTONE } from "../domain/anonymise";
import type { RetentionAction, SubjectRef } from "../domain/retention-plan";
import { DATA_INVENTORY } from "../inventory";
import {
  nextCursor,
  type CandidatePage,
  type CandidateQuery,
  type RetentionPolicy,
} from "./types";

type TableWithId = PgTable & { id: PgColumn };

/** A subject type a hold names, and the column holding its id. */
export type SubjectColumn = readonly [
  type: string | PgColumn,
  column: PgColumn | SQL,
];

/** Every non-null subject id of one selected row. */
export function subjectsOf(
  row: Record<string, unknown>,
  columns: readonly SubjectColumn[]
): SubjectRef[] {
  const subjects: SubjectRef[] = [];
  columns.forEach(([type], index) => {
    const id = row[`subject${index}`];
    const subjectType = typeof type === "string" ? type : row[`type${index}`];
    if (typeof id === "string" && typeof subjectType === "string") {
      subjects.push({ type: subjectType, id });
    }
  });
  return subjects;
}

export function subjectSelection(columns: readonly SubjectColumn[]) {
  const fields: Record<string, PgColumn | SQL> = {};
  columns.forEach(([type, column], index) => {
    fields[`subject${index}`] = column;
    if (typeof type !== "string") fields[`type${index}`] = type;
  });
  return fields;
}

/** `instant <= cutoff`, with the cutoff sent as a timestamptz. */
export function atOrBefore(instant: SQL | PgColumn, cutoff: Date): SQL {
  return sql`${instant} <= ${cutoff.toISOString()}::timestamptz`;
}

/** The inventory's entries that `policyKey` blanks on `table`. */
function entriesBlankedBy(policyKey: string, tableName: string) {
  return DATA_INVENTORY.filter(
    (entry) =>
      entry.table === tableName &&
      entry.retention.policy === policyKey &&
      (entry.onExpiry === "set_null" || entry.onExpiry === "tombstone")
  );
}

/**
 * The column values, by property name, that anonymise a row of `table`
 * for `policyKey`, from the data inventory. The placeholder replaces a
 * value; a column that is empty stays empty, so a row never gains data
 * (or breaks a check that ties the column to the row's state).
 */
export function anonymiseSet(
  policyKey: string,
  table: PgTable
): Record<string, SQL | null> {
  const name = getTableName(table);
  const patch = anonymisePatch(entriesBlankedBy(policyKey, name), name);
  const columns = Object.entries(getTableColumns(table));
  return Object.fromEntries(
    Object.entries(patch).map(([sqlName, value]) => {
      const property = columns.find(([, column]) => column.name === sqlName);
      if (!property) {
        throw new Error(`${name} has no column "${sqlName}" to anonymise`);
      }
      const [key, column] = property;
      return [
        key,
        value === null
          ? null
          : sql`CASE WHEN ${column} IS NULL THEN NULL ELSE ${value} END`,
      ];
    })
  );
}

/**
 * True for a row of `table` that `policyKey` hasn't anonymised yet: a
 * column it nulls still holds a value, or one it overwrites isn't the
 * placeholder yet. Keeps a second run from counting the row again.
 */
export function notYetAnonymised(policyKey: string, table: PgTable): SQL {
  const name = getTableName(table);
  const columns = Object.values(getTableColumns(table));
  const conditions = entriesBlankedBy(policyKey, name).map((entry) => {
    const column = columns.find((each) => each.name === entry.column);
    if (!column) throw new Error(`${name} has no column "${entry.column}"`);
    return entry.onExpiry === "set_null"
      ? isNotNull(column)
      : ne(column, TOMBSTONE);
  });
  const any = or(...conditions);
  if (!any)
    throw new Error(`The inventory gives ${policyKey} nothing to blank`);
  return any;
}

export function rowPolicy(definition: {
  key: string;
  table: TableWithId;
  action: RetentionAction;
  period: RetentionPolicy["period"] | TimedPolicyKey;
  /** The instant each row's period counts from. */
  anchor: SQL<Date> | PgColumn;
  /** Scan through a compound index on the anchor and id. */
  orderByAnchor?: boolean;
  /** Which rows the policy covers at all; every row when absent. */
  where?: SQL;
  subjects?: readonly SubjectColumn[];
}): RetentionPolicy {
  const { key, table, action, anchor, orderByAnchor } = definition;
  const subjectColumns = definition.subjects ?? [];
  const period =
    typeof definition.period === "string"
      ? ({ kind: "timed", key: definition.period } as const)
      : definition.period;
  const covered =
    action === "anonymise"
      ? and(definition.where, notYetAnonymised(key, table))
      : definition.where;
  const set = action === "anonymise" ? anonymiseSet(key, table) : undefined;

  async function candidates(
    db: AppDb,
    { cutoff, after, limit }: CandidateQuery
  ): Promise<CandidatePage> {
    const selection: Record<string, PgColumn | SQL> = {
      id: table.id,
      anchor,
      ...subjectSelection(subjectColumns),
    };
    // Keep the sub-millisecond part of the database value in the cursor.
    if (orderByAnchor) selection.cursorAnchor = sql`${anchor}::text`;
    const remaining =
      after?.anchor !== undefined
        ? sql`(${anchor}, ${table.id}) > (${after.anchor}::timestamptz, ${after.id}::uuid)`
        : after
          ? gt(table.id, after.id)
          : undefined;
    const rows = (await db
      .select(selection)
      .from(table as PgTable)
      .where(and(covered, atOrBefore(anchor, cutoff), remaining))
      .orderBy(
        ...(orderByAnchor ? [asc(anchor), asc(table.id)] : [asc(table.id)])
      )
      .limit(limit)
      .for("update")) as Record<string, unknown>[];
    const candidates = rows.map((row) => ({
      id: row.id as string,
      anchor: row.anchor as Date,
      subjects: subjectsOf(row, subjectColumns),
    }));
    const next = nextCursor(candidates, limit);
    return {
      candidates,
      next:
        next && orderByAnchor
          ? { ...next, anchor: rows.at(-1)!.cursorAnchor as string }
          : next,
    };
  }

  async function apply(db: AppDb, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const chosen = inArray(table.id, [...ids]);
    if (set) await db.update(table).set(set).where(chosen);
    else await db.delete(table).where(chosen);
  }

  return {
    key,
    table: getTableName(table),
    action,
    period,
    candidates,
    apply,
  };
}

/** An instant computed in SQL, read back as a Date like `like`. */
export function instant(expression: SQL, like: PgColumn): SQL<Date> {
  return sql`${expression}`.mapWith((value: unknown) =>
    like.mapFromDriverValue(value)
  ) as SQL<Date>;
}
