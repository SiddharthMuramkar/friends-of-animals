import { describe, expect, it } from "vitest";

import { readStudentCsv } from "@/server/modules/registration/domain/student-csv";
import { registeredSchool } from "@/server/modules/registration/testing";
import { SAMPLE_STUDENT_IMPORT_CSV } from "@/server/seed/student-import-samples";
import { createHarness } from "@/test/harness";

import { studentImportDownload } from "./csv-downloads";

const BOM = "\uFEFF";
const TEMPLATE_HEADER =
  "student_ref,full_name,date_of_birth,grade,guardian_name,guardian_relationship,guardian_phone,guardian_email,student_phone,student_email,address,pin_code,city,state";

describe("studentImportDownload", () => {
  it("gives a coordinator the blank template: a UTF-8 header row, as an attachment never cached", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);

    const download = await studentImportDownload(
      h.as(school.coordinator.actor),
      {
        institutionId: school.institutionId,
        reference: school.reference,
        file: "template.csv",
      },
      { samples: false }
    );

    expect(download).toEqual({
      status: 200,
      body: `${BOM}${TEMPLATE_HEADER}\r\n`,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="students-template.csv"',
        "Cache-Control": "no-store",
      },
    });
    // Uploaded as it is, it holds nobody.
    expect(
      readStudentCsv(new TextEncoder().encode(download.body ?? ""))
    ).toEqual({ ok: false, problem: { code: "no_rows" } });
  });

  it("gives the sample file where sample content shows, and the 404 in production", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const request = {
      institutionId: school.institutionId,
      reference: school.reference,
      file: "sample.csv",
    } as const;
    const coordinator = h.as(school.coordinator.actor);

    const preview = await studentImportDownload(coordinator, request, {
      samples: true,
    });
    const production = await studentImportDownload(coordinator, request, {
      samples: false,
    });

    expect(preview).toMatchObject({
      status: 200,
      body: `${BOM}${SAMPLE_STUDENT_IMPORT_CSV}`,
      headers: {
        "Content-Disposition": 'attachment; filename="students-sample.csv"',
        "Cache-Control": "no-store",
      },
    });
    expect(production).toMatchObject({ status: 404, body: null });
  });

  it("refuses someone who may not import, and finds no registration under an unknown reference", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const member = h.as(await h.signIn(await h.seed.member()));
    const coordinator = h.as(school.coordinator.actor);

    const forbidden = await studentImportDownload(
      member,
      {
        institutionId: school.institutionId,
        reference: school.reference,
        file: "template.csv",
      },
      { samples: true }
    );
    const unknown = await studentImportDownload(
      coordinator,
      {
        institutionId: school.institutionId,
        reference: "NOPE27-I-00000",
        file: "template.csv",
      },
      { samples: true }
    );
    const noInstitution = await studentImportDownload(
      coordinator,
      {
        institutionId: null,
        reference: school.reference,
        file: "template.csv",
      },
      { samples: true }
    );

    expect(forbidden).toMatchObject({ status: 403, body: null });
    expect(unknown).toMatchObject({ status: 404, body: null });
    expect(noInstitution).toMatchObject({ status: 404, body: null });
    for (const refused of [forbidden, unknown, noInstitution]) {
      expect(refused.headers).toEqual({ "Cache-Control": "no-store" });
    }
  });
});
