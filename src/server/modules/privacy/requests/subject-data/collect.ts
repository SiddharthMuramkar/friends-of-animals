// Gathers one person's data for their export (#115b): every section's rows
// (./sections.ts) with encrypted columns decrypted, the ids of other rows
// that name them, and the bytes of their own uploads. Each row passes
// ./guard.ts first, so a row that isn't theirs stops the export.
//
// Decrypted values exist only here and in the archive the job stores: the
// worker never logs them or puts them in an outbox payload.
//
// Loads under plain Node: relative imports only, no "server-only".

import { getTableColumns, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { FieldCipher } from "../../../../crypto/field-cipher";
import type { AppDb } from "../../../../db/app-db";
import type { ObjectStorage } from "../../../../ports/storage";
import { assertRowsBelongToSubject } from "./guard";
import type { SubjectScope } from "./scope";
import {
  columnNamed,
  NOT_EXPORTED,
  PARTICIPANT_FILE_PURPOSES,
  REFERENCE_COLUMNS,
  SECTIONS,
  sectionName,
  TABLES_BY_NAME,
} from "./sections";

/** The upload purposes whose bytes go in the export: the person's own work and forms. */
const FILE_PURPOSES_WITH_BYTES = new Set<string>([
  ...PARTICIPANT_FILE_PURPOSES,
  "test_upload",
]);

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "video/webm": "webm",
};

export type ExportFile = {
  id: string;
  purpose: string;
  contentType: string;
  path: string;
};

export type ExportDocument = {
  format: "foa-subject-export/1";
  generatedAt: string;
  request: { reference: string };
  subject: { kind: string; id: string };
  sections: Record<string, Record<string, unknown>[]>;
  references: Record<string, string[]>;
  files: ExportFile[];
  notIncluded: Record<string, string>;
};

/** A database value as JSON: instants as ISO text, big integers as text. */
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** A row keyed by SQL column name. */
function bySqlName(
  table: PgTable,
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    out[column.name] = row[property];
  }
  return out;
}

async function bytesOf(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function collectSubjectData(
  deps: { db: AppDb; cipher: FieldCipher; storage: ObjectStorage },
  input: {
    scope: SubjectScope;
    subject: { kind: string; id: string };
    reference: string;
    generatedAt: Date;
  }
): Promise<{
  document: ExportDocument;
  files: { name: string; bytes: Uint8Array }[];
}> {
  const { db, cipher, storage } = deps;
  const { scope } = input;
  const userIds = new Set<string>(scope.userIds);
  const allowed = new Set<string>([...scope.userIds, ...scope.profileIds]);
  const sections: ExportDocument["sections"] = {};
  const fileRows: Record<string, unknown>[] = [];
  // File ownership follows a previously validated entry, signed form, or
  // custody photo, not the school coordinator or guardian who uploaded it.
  const participantFileIds = new Set<string>();
  const participantPurposes = new Set<string>(PARTICIPANT_FILE_PURPOSES);

  for (const section of SECTIONS) {
    const name = sectionName(section);
    const raw = (
      await db.select().from(section.table).where(section.where(scope))
    ).map((row) => bySqlName(section.table, row));
    if (name === "file_asset") {
      for (const row of raw) {
        const participantFile = participantPurposes.has(String(row.purpose));
        assertRowsBelongToSubject(
          name,
          [row],
          participantFile ? ["id"] : ["owner_user_id"],
          participantFile ? participantFileIds : userIds
        );
      }
    } else {
      assertRowsBelongToSubject(name, raw, section.owners, allowed);
    }
    if (["entry_file", "consent_form", "artwork_photo"].includes(name)) {
      for (const row of raw) {
        if (typeof row.file_asset_id === "string") {
          participantFileIds.add(row.file_asset_id);
        }
      }
    }
    for (const row of raw) {
      if (typeof row.id === "string") allowed.add(row.id);
    }
    if (name === "file_asset") fileRows.push(...raw);
    if (raw.length === 0) continue;
    const withheld = new Set(section.withhold ?? []);
    const included = section.include && new Set(section.include);
    sections[name] = raw.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(row)) {
        if (withheld.has(column) || (included && !included.has(column)))
          continue;
        const purpose = section.decrypt?.[column];
        if (purpose !== undefined) {
          out[column.replace(/_ciphertext$/, "")] =
            value === null ? null : cipher.decrypt(purpose, value as string);
        } else {
          out[column] = jsonValue(value);
        }
      }
      return out;
    });
  }

  const references: ExportDocument["references"] = {};
  if (scope.userIds.length > 0) {
    for (const { table, column } of REFERENCE_COLUMNS) {
      const pgTable = TABLES_BY_NAME.get(table)!;
      const rows = (await db
        .select({ id: columnNamed(pgTable, "id") })
        .from(pgTable)
        .where(inArray(columnNamed(pgTable, column), [...scope.userIds]))) as {
        id: string;
      }[];
      if (rows.length > 0) {
        references[`${table}.${column}`] = rows.map((row) => row.id).sort();
      }
    }
  }

  const files: { name: string; bytes: Uint8Array }[] = [];
  const listed: ExportFile[] = [];
  for (const row of fileRows) {
    const purpose = row.purpose as string;
    if (row.status !== "clean" || !FILE_PURPOSES_WITH_BYTES.has(purpose)) {
      continue;
    }
    const id = row.id as string;
    const contentType = row.content_type as string;
    const path = `files/${id}.${EXTENSIONS[contentType] ?? "bin"}`;
    files.push({
      name: path,
      bytes: await bytesOf(
        await storage.read({
          bucket: row.bucket as string,
          key: row.storage_key as string,
        })
      ),
    });
    listed.push({ id, purpose, contentType, path });
  }

  return {
    document: {
      format: "foa-subject-export/1",
      generatedAt: input.generatedAt.toISOString(),
      request: { reference: input.reference },
      subject: input.subject,
      sections,
      references,
      files: listed,
      notIncluded: { ...NOT_EXPORTED },
    },
    files,
  };
}
