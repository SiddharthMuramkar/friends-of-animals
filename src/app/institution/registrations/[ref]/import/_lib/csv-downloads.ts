// The student import's two downloads (#76), as a plain function over the
// use cases so they are tested at Seam 1; the route handlers only resolve
// the actor and pass the request in.
//
//   GET .../import/template.csv?institution=<id>  the blank template
//   GET .../import/sample.csv?institution=<id>    the sample, never in production
//
// Both go to whoever may import into the registration
// (describeStudentImport decides), as attachments that are never cached.

import type { UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";
import { studentCsvTemplate } from "@/server/modules/registration/domain/student-csv";
import { SAMPLE_STUDENT_IMPORT_CSV } from "@/server/seed/student-import-samples";

export type StudentImportFile = "template.csv" | "sample.csv";

export type CsvDownload = {
  status: number;
  body: string | null;
  headers: Record<string, string>;
};

/** Makes Excel open the file as UTF-8, so names in any script survive. */
const BOM = "﻿";

const FILES: Record<
  StudentImportFile,
  { name: string; body: () => string; sample: boolean }
> = {
  "template.csv": {
    name: "students-template.csv",
    body: studentCsvTemplate,
    sample: false,
  },
  "sample.csv": {
    name: "students-sample.csv",
    body: () => BOM + SAMPLE_STUDENT_IMPORT_CSV,
    sample: true,
  },
};

const refused = (status: number): CsvDownload => ({
  status,
  body: null,
  headers: { "Cache-Control": "no-store" },
});

export async function studentImportDownload(
  app: Pick<UseCases, "describeStudentImport">,
  request: {
    institutionId: string | null;
    reference: string;
    file: StudentImportFile;
  },
  { samples }: { samples: boolean }
): Promise<CsvDownload> {
  const file = FILES[request.file];
  if (file.sample && !samples) return refused(404);
  if (!request.institutionId) return refused(404);
  let described: Awaited<ReturnType<UseCases["describeStudentImport"]>>;
  try {
    described = await app.describeStudentImport({
      institutionId: request.institutionId,
      reference: request.reference,
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return refused(403);
    }
    throw error;
  }
  if (!described.ok) return refused(404);
  return {
    status: 200,
    body: file.body(),
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Cache-Control": "no-store",
    },
  };
}

/** The download as the route handler answers it. */
export function toResponse({ status, body, headers }: CsvDownload): Response {
  return new Response(body, { status, headers });
}
