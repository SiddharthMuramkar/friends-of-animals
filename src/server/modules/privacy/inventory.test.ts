import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
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

/**
 * A column built with encryptedText() (src/server/db/types/encrypted-text.ts):
 * the schema's only custom column type stored as plain text. Found by its
 * type, so a column that is encrypted but misnamed is still caught.
 */
const builtEncrypted = (column: PgColumn) =>
  column.columnType === "PgCustomColumn" && column.getSQLType() === "text";

describe("the data inventory", () => {
  it("lists every encrypted column in the schema", () => {
    const encrypted = tables.flatMap((table) =>
      table.columns
        .filter(
          (column) =>
            column.name.endsWith("_ciphertext") || builtEncrypted(column)
        )
        .map((column) => `${table.name}.${column.name}`)
    );

    expect(encrypted).toContain("institution.principal_email_ciphertext");
    expect(encrypted).toContain("user.phone_ciphertext");
    expect(encrypted.filter((column) => !listed.has(column))).toEqual([]);
  });

  it("finds each encrypted column by its name, which ends in _ciphertext", () => {
    const misnamed = tables.flatMap((table) =>
      table.columns
        .filter(
          (column) =>
            builtEncrypted(column) && !column.name.endsWith("_ciphertext")
        )
        .map((column) => `${table.name}.${column.name}`)
    );

    expect(misnamed).toEqual([]);
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

  it("lists every personal-data column of a safeguarding report and its log", () => {
    expect(
      [
        "safeguarding_report.description_ciphertext",
        "safeguarding_report.subject_details_ciphertext",
        "safeguarding_report.subject_age",
        "safeguarding_report.reporter_name_ciphertext",
        "safeguarding_report.reporter_contact_ciphertext",
        "safeguarding_report.escalation_reference_ciphertext",
        "safeguarding_report.outcome_ciphertext",
        "safeguarding_report.assigned_to_user_id",
        "safeguarding_incident_log.body_ciphertext",
        "safeguarding_incident_log.author_user_id",
      ].filter((column) => !listed.has(column))
    ).toEqual([]);
  });

  it("lists every personal-data column of a blog post or story", () => {
    expect(
      ["author_name", "created_by", "updated_by"].filter(
        (column) => !listed.has(`cms_post.${column}`)
      )
    ).toEqual([]);
  });

  it("lists every personal-data column of an offline payment and a payment in review (#79)", () => {
    expect(
      [
        "offline_payment.reference",
        "offline_payment.proof_file_asset_id",
        "offline_payment.recorded_by_user_id",
        "payment_review_case.resolution_reason",
        "payment_review_case.resolved_by_user_id",
      ].filter((column) => !listed.has(column))
    ).toEqual([]);
  });

  it("lists who registered an institution for a competition", () => {
    expect(listed.has("institution_registration.registered_by")).toBe(true);
  });

  it("lists every personal-data column of a participant profile", () => {
    expect(
      [
        "full_name",
        "dob_ciphertext",
        "grade",
        "student_ref",
        "phone_ciphertext",
        "email_ciphertext",
        "guardian_name_ciphertext",
        "guardian_relationship",
        "guardian_phone_ciphertext",
        "guardian_email_ciphertext",
        "address_ciphertext",
        "pin_code",
        "city",
        "state",
        "identity_hash",
        "created_by",
      ].filter((column) => !listed.has(`participant_profile.${column}`))
    ).toEqual([]);
  });

  it("lists every personal-data column an adult's own profile adds (#78)", () => {
    expect(
      [
        "owner_user_id",
        "participant_code",
        "country",
        "school_name",
        "dob_ciphertext",
        "phone_ciphertext",
        "pin_code",
        "city",
        "state",
      ].filter((column) => !listed.has(`participant_profile.${column}`))
    ).toEqual([]);
  });

  it("says each shared participant column is kept for adults on their own too (#78)", () => {
    for (const column of ["full_name", "dob_ciphertext", "phone_ciphertext"]) {
      const entry = DATA_INVENTORY.find(
        (each) => each.table === "participant_profile" && each.column === column
      );
      expect(entry?.purpose, column).toMatch(/adult/i);
      expect(entry?.retention.period, column).toMatch(/adult|participant/i);
    }
  });

  it("lists every personal-data column of a guardian, their links and invitations (#81)", () => {
    expect(
      [
        "guardian.user_id",
        "guardian.full_name_ciphertext",
        "guardian.phone_ciphertext",
        "guardian.phone_hash",
        "guardian.adult_declared_at",
        "guardian.verified_at",
        "guardian_link.relationship",
        "guardian_invitation.contact_ciphertext",
        "guardian_invitation.contact_hash",
        "guardian_invitation.token_ciphertext",
        "guardian_invitation.accepted_by_user_id",
        "participant_profile.login_user_id",
      ].filter((column) => !listed.has(column))
    ).toEqual([]);
  });

  it("lists every personal-data column of a teen's guardian request, kept 30 days after it closes (#81)", () => {
    const columns = [
      "invitee_name_ciphertext",
      "relationship",
      "requested_by_user_id",
    ];
    expect(
      columns.filter((column) => !listed.has(`guardian_invitation.${column}`))
    ).toEqual([]);
    for (const column of columns) {
      const entry = DATA_INVENTORY.find(
        (each) => each.table === "guardian_invitation" && each.column === column
      );
      expect(entry?.retention.period, column).toMatch(/^30 days after/);
      expect(entry?.retention.toConfirm, column).toBe(true);
    }
  });

  it("says a profile's shared columns are kept for a guardian's child too (#81)", () => {
    for (const column of ["full_name", "dob_ciphertext", "owner_user_id"]) {
      const entry = DATA_INVENTORY.find(
        (each) => each.table === "participant_profile" && each.column === column
      );
      expect(entry?.purpose, column).toMatch(/guardian/i);
    }
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
