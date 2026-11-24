import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";
import * as schema from "@/server/db/schema";
import { CONTACT_INVENTORY } from "@/server/modules/contact/inventory";

import { checkInventoryCoverage } from "./domain/coverage";
import { schemaColumns } from "./domain/schema-columns";
import { DATA_INVENTORY } from "./inventory";
import { NON_PERSONAL } from "./non-personal";
import { LIFECYCLE_POLICY_KEYS, RETENTION_POLICY_KEYS } from "./policies";

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

  it("explains every retention policy on the privacy page, and names each lifecycle from an entry", () => {
    expect(new Set(Object.keys(messages.adminPrivacy.policies.items))).toEqual(
      RETENTION_POLICY_KEYS
    );
    const named = new Set(
      DATA_INVENTORY.map(({ retention }) => retention.policy)
    );
    expect(LIFECYCLE_POLICY_KEYS.filter((key) => !named.has(key))).toEqual([]);
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

  it("lists who wrote and sent an announcement, and a contact's delivery key (#84)", () => {
    expect(listed.has("announcement.created_by")).toBe(true);
    expect(listed.has("announcement.sent_by")).toBe(true);
    expect(listed.has("message_delivery.contact_hash")).toBe(true);
  });

  it("lists encrypted announcement help contacts with their purpose and retention", () => {
    expect(
      DATA_INVENTORY.find(
        ({ table, column }) =>
          table === "announcement" && column === "help_contacts_ciphertext"
      )
    ).toMatchObject({
      table: "announcement",
      column: "help_contacts_ciphertext",
      purpose: expect.stringContaining("help"),
      retention: expect.objectContaining({
        period: expect.stringContaining("competition"),
        toConfirm: true,
      }),
    });
    expect(listed.has("message_delivery.recipient_hashes")).toBe(true);
    expect(listed.has("message_delivery.recipient_account_hash")).toBe(true);
  });

  it("lists encrypted announcement inbox content with its retention period", () => {
    for (const column of ["title_ciphertext", "body_ciphertext"]) {
      expect(
        DATA_INVENTORY.find(
          (entry) => entry.table === "inbox_item" && entry.column === column
        )
      ).toMatchObject({
        purpose: expect.stringContaining("announcement"),
        retention: {
          period: expect.stringContaining("365 days after the person reads it"),
          basis: expect.any(String),
          toConfirm: true,
        },
      });
    }
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

  it("lists entry text, participant links and stored images with provisional retention (#85)", () => {
    const columns = [
      "entry.code",
      "entry.registration_id",
      "entry.participant_profile_id",
      "entry.title",
      "entry.description",
      "entry.statement",
      "entry.created_by_user_id",
      "entry_file.id",
      "entry_file.entry_id",
      "entry_file.file_asset_id",
      "entry_file.uploaded_by_user_id",
      "entry_file.pending_text",
      "entry_file.receipt_title",
      "entry_upload_grant.file_asset_id",
      "entry_upload_grant.registration_id",
      "entry_upload_grant.upload_key",
      "entry_transition.entry_id",
      "entry_transition.entry_file_id",
      "entry_transition.actor_user_id",
      "file_asset.owner_user_id",
      "file_asset.storage_key",
      "file_derivative.file_asset_id",
      "file_derivative.storage_key",
    ];
    expect(columns.filter((column) => !listed.has(column))).toEqual([]);
    const entryData = DATA_INVENTORY.filter((item) =>
      columns.includes(`${item.table}.${item.column}`)
    );
    expect(entryData.every(({ retention }) => retention.toConfirm)).toBe(true);
  });

  it("keeps consent-link contacts for 90 days and answers with the evidence record", () => {
    for (const column of ["contact_ciphertext", "contact_hash"]) {
      const entry = DATA_INVENTORY.find(
        (each) => each.table === "consent_link" && each.column === column
      );
      expect(entry?.retention.period).toMatch(/^90 days after/);
      expect(entry?.retention.toConfirm).toBe(true);
    }
    for (const [table, column] of [
      ["consent_link", "answers"],
      ["consent_event", "giver_contact_hash"],
      ["consent_event", "consent_link_id"],
    ]) {
      const entry = DATA_INVENTORY.find(
        (each) => each.table === table && each.column === column
      );
      expect(entry?.retention.period).toMatch(/consent applies, then 3 years/);
      expect(entry?.retention.toConfirm).toBe(true);
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

  it("covers signed-form scope, evidence, and the identities who submitted and reviewed it", () => {
    const formPeriod =
      "While the consent applies, then 3 years. For forms that did not grant consent, 3 years after closure";
    const consentPeriod = "While the consent applies, then 3 years";
    const expected = [
      ["consent_form", "file_asset_id", formPeriod],
      ["consent_form", "participant_profile_id", formPeriod],
      ["consent_form", "competition_id", formPeriod],
      ["consent_form", "institution_registration_id", formPeriod],
      ["consent_form", "uses", formPeriod],
      ["consent_form", "documents", formPeriod],
      ["consent_form", "uploaded_by_user_id", formPeriod],
      ["consent_form", "reviewed_by_user_id", formPeriod],
      ["consent_form", "rejection_note", formPeriod],
      ["consent_form_upload", "file_asset_id", formPeriod],
      ["consent_form_upload", "registration_id", formPeriod],
      ["consent_event", "consent_form_id", consentPeriod],
      ["consent_event", "reviewer_user_id", consentPeriod],
      [
        "institution_registration",
        "participation_declared_by_user_id",
        "While the institution takes part, then 3 years after the competition ends",
      ],
    ];
    for (const [table, column, period] of expected) {
      expect
        .soft(
          DATA_INVENTORY.find(
            (entry) => entry.table === table && entry.column === column
          ),
          `${table}.${column}`
        )
        .toMatchObject({
          purpose: expect.any(String),
          retention: { period, toConfirm: true },
        });
    }
  });

  it("gives each entry a purpose and a retention marked to confirm", () => {
    for (const entry of DATA_INVENTORY) {
      expect(entry.purpose.length).toBeGreaterThan(10);
      expect(entry.retention.period.length).toBeGreaterThan(5);
      expect(entry.retention.toConfirm).toBe(true);
    }
  });
});
