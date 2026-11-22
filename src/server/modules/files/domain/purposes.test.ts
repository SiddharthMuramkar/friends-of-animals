import { describe, expect, it } from "vitest";

import {
  checkStoredObject,
  checkUploadRequest,
  normaliseContentType,
  PURPOSE_RULES,
} from "./purposes";

const MiB = 1024 * 1024;
const png = { purpose: "test_upload", contentType: "image/png" } as const;

describe("checkUploadRequest", () => {
  it("accepts an allowed type within the size limit", () => {
    expect(checkUploadRequest({ ...png, sizeBytes: 1234 }, "preview")).toEqual({
      ok: true,
    });
    expect(
      checkUploadRequest({ ...png, sizeBytes: 10 * MiB }, "local")
    ).toEqual({ ok: true });
  });

  it("refuses a file over the purpose's limit", () => {
    expect(
      checkUploadRequest({ ...png, sizeBytes: 10 * MiB + 1 }, "preview")
    ).toEqual({ ok: false, refusal: "too_large" });
  });

  it("refuses an empty or nonsensical size", () => {
    for (const sizeBytes of [0, -1, 1.5, Number.NaN]) {
      expect(checkUploadRequest({ ...png, sizeBytes }, "preview")).toEqual({
        ok: false,
        refusal: "empty",
      });
    }
  });

  it("refuses a type the purpose doesn't allow", () => {
    for (const contentType of [
      "text/html",
      "image/svg+xml",
      "application/octet-stream",
      "",
      "image/png; charset=utf-8",
    ]) {
      expect(
        checkUploadRequest(
          { purpose: "test_upload", contentType, sizeBytes: 10 },
          "preview"
        )
      ).toEqual({ ok: false, refusal: "type_not_allowed" });
    }
  });

  it("matches the declared type whatever its case or spacing", () => {
    expect(
      checkUploadRequest(
        { purpose: "test_upload", contentType: " Image/PNG ", sizeBytes: 10 },
        "preview"
      )
    ).toEqual({ ok: true });
  });

  it("keeps test uploads out of production", () => {
    expect(checkUploadRequest({ ...png, sizeBytes: 10 }, "production")).toEqual(
      { ok: false, refusal: "purpose_unavailable" }
    );
    for (const appEnv of ["local", "preview", "staging"] as const) {
      expect(checkUploadRequest({ ...png, sizeBytes: 10 }, appEnv).ok).toBe(
        true
      );
    }
  });

  it("checks the purpose before the type and the type before the size", () => {
    expect(
      checkUploadRequest(
        { purpose: "test_upload", contentType: "text/html", sizeBytes: 0 },
        "production"
      )
    ).toEqual({ ok: false, refusal: "purpose_unavailable" });
    expect(
      checkUploadRequest(
        { purpose: "test_upload", contentType: "text/html", sizeBytes: 0 },
        "preview"
      )
    ).toEqual({ ok: false, refusal: "type_not_allowed" });
  });

  it("allows only types that are safe to serve back", () => {
    for (const rule of Object.values(PURPOSE_RULES)) {
      for (const type of rule.contentTypes) {
        expect(type).not.toMatch(/html|svg|xml|javascript/);
      }
    }
  });
});

describe("normaliseContentType", () => {
  it("trims and lower-cases", () => {
    expect(normaliseContentType("  Application/PDF ")).toBe("application/pdf");
  });
});

describe("checkStoredObject", () => {
  const declared = { contentType: "image/png", sizeBytes: 1234 };

  it("accepts an object that matches what was declared", () => {
    expect(
      checkStoredObject(declared, { sizeBytes: 1234, contentType: "image/png" })
    ).toEqual({ ok: true });
  });

  it("notices a missing object", () => {
    expect(checkStoredObject(declared, null)).toEqual({
      ok: false,
      refusal: "upload_missing",
    });
  });

  it("refuses a different size", () => {
    expect(
      checkStoredObject(declared, { sizeBytes: 1235, contentType: "image/png" })
    ).toEqual({ ok: false, refusal: "size_mismatch" });
  });

  it("refuses a different or missing type", () => {
    for (const contentType of ["image/jpeg", null]) {
      expect(
        checkStoredObject(declared, { sizeBytes: 1234, contentType })
      ).toEqual({ ok: false, refusal: "type_mismatch" });
    }
  });

  it("compares types the way the request check does", () => {
    expect(
      checkStoredObject(declared, { sizeBytes: 1234, contentType: "IMAGE/PNG" })
    ).toEqual({ ok: true });
  });
});
