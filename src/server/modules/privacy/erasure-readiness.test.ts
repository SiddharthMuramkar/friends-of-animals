// Deleting a person's account (#115b builds the erasure flow on it) must
// never fail on a reference the schema forgot. This lists every reference
// to an account whose ON DELETE would refuse the deletion, so a new one is
// a decision, not an accident. Erasure deals with each first.
//
// institution.created_by stays NOT NULL (Decision 2, #114): the authorised
// person who registered an institution can't be deleted while it names
// them, and erasure hands the institution to someone else first. The same
// holds for directory_listing.owner_user_id (#127): erasure withdraws the
// person's listings, or hands them to another representative, first.
// A terminal listing may have no owner; the FK still rejects accidental
// deletion before erasure has taken care of it.

import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

/** References to an account whose ON DELETE would refuse to delete it. */
function referencesBlockingAccountDeletion(): string[] {
  const tables = new Set(
    (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
      is(value, PgTable)
    )
  );
  const blocking: string[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      if (getTableConfig(reference.foreignTable).name !== "user") continue;
      const onDelete = foreignKey.onDelete ?? "no action";
      if (onDelete === "cascade" || onDelete === "set null") continue;
      const columns = reference.columns.map((column) => column.name).join();
      blocking.push(`${config.name}.${columns} (${onDelete})`);
    }
  }
  return blocking.sort();
}

describe("deleting an account", () => {
  it("is refused only by the references erasure deals with first (#115b)", () => {
    expect(referencesBlockingAccountDeletion()).toEqual([
      "certificate.recipient_user_id (no action)",
      "consent_event.reviewer_user_id (no action)",
      "consent_form.reviewed_by_user_id (restrict)",
      "consent_form.uploaded_by_user_id (restrict)",
      "directory_listing.owner_user_id (no action)",
      "file_asset.owner_user_id (restrict)",
      "institution.created_by (no action)",
    ]);
  });
});
