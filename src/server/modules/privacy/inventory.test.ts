import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";
import * as schema from "@/server/db/schema";
import { CONTACT_INVENTORY } from "@/server/modules/contact/inventory";

import { checkInventoryCoverage } from "./domain/coverage";
import { schemaColumns } from "./domain/schema-columns";
import { DATA_INVENTORY, RETENTION_POLICY_KEYS } from "./inventory";
import { NON_PERSONAL } from "./non-personal";

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
  it("classifies every column in the schema exactly once", () => {
    expect(
      checkInventoryCoverage({
        columns: schemaColumns(schema),
        inventory: DATA_INVENTORY,
        nonPersonal: NON_PERSONAL,
        policies: RETENTION_POLICY_KEYS,
      })
    ).toEqual([]);
  });

  it("has one non-empty purpose message for every catalogue field", () => {
    const purposes = Object.entries(
      messages.adminPrivacy.inventory.purposes
    ).flatMap(([table, columns]) =>
      Object.entries(columns).map(
        ([column, purpose]) => [`${table}.${column}`, purpose] as const
      )
    );
    expect(new Set(purposes.map(([key]) => key))).toEqual(listed);
    expect(purposes.filter(([, purpose]) => !purpose.trim())).toEqual([]);
    expect(new Map(purposes)).toEqual(
      new Map(
        DATA_INVENTORY.map(({ table, column, purpose }) => [
          `${table}.${column}`,
          purpose,
        ])
      )
    );
  });

  it("has a staff-facing label for every data subject kind", () => {
    const kinds = new Set(DATA_INVENTORY.map(({ subject }) => subject.kind));
    expect(messages.adminPrivacy.inventory).toMatchObject({
      subjectKinds: Object.fromEntries(
        [...kinds].map((kind) => [kind, expect.stringMatching(/\S/)])
      ),
    });
  });

  it("includes the contact module's entries for messages and staff notes", () => {
    const contactEntries = DATA_INVENTORY.filter(
      ({ table }) => table === "contact_message" || table === "contact_note"
    );
    expect(contactEntries).toEqual(CONTACT_INVENTORY);
  });

  it("classifies private decision text and recorded age information as personal data", () => {
    expect(DATA_INVENTORY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "institution",
          column: "status_reason",
          category: "content",
          subject: { kind: "institution", via: "id" },
          retention: expect.objectContaining({ policy: "institutions" }),
        }),
        expect.objectContaining({
          table: "registration",
          column: "age_group_id",
          category: "demographic",
          subject: {
            kind: "participant_profile",
            via: "participant_profile_id",
          },
          retention: expect.objectContaining({ policy: "participants" }),
        }),
        expect.objectContaining({
          table: "safeguarding_report",
          column: "reporter_is_child",
          category: "demographic",
          subject: { kind: "safeguarding_report", via: "id" },
          retention: expect.objectContaining({ policy: "safeguardingReports" }),
        }),
        expect.objectContaining({
          table: "payment_review_case",
          column: "resolution_reason",
          category: "content",
          subject: { kind: "payer", via: "batch_id" },
          retention: expect.objectContaining({ policy: "financialRecords" }),
        }),
        expect.objectContaining({
          table: "refund",
          column: "decision_note",
          category: "content",
          subject: { kind: "payer", via: "batch_id" },
          retention: expect.objectContaining({ policy: "financialRecords" }),
        }),
      ])
    );
  });

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
        "status_reason",
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
        "safeguarding_report.reporter_is_child",
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
