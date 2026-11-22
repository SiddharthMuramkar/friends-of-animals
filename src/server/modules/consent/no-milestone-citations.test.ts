import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Repo rule: code comments and test titles cite issues (#82), never spec
// sections or milestone names, which go stale as plans move. This guards
// the consent module and the pages that only it serves.

const root = path.join(import.meta.dirname, "../../../..");

const CONSENT_PATHS = [
  "src/server/modules/consent",
  "src/server/seed/consent.ts",
  "src/app/(staff)/admin/consent-documents",
  "src/app/account/consents",
  "src/app/(auth)/_components/messages-consent-field.tsx",
  "src/content/legal/messages-consent.ts",
  "tests/e2e/64-consent.spec.ts",
];

const SELF = path.relative(root, import.meta.filename);

function sourceFiles(relative: string): string[] {
  const full = path.join(root, relative);
  if (!statSync(full).isDirectory()) return [relative];
  return readdirSync(full, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => path.join(relative, file));
}

/** A milestone name such as M0 or M12, or a section sign. */
const CITATION = /\bM\d{1,2}\b|§/;

describe("consent sources", () => {
  it("cite issues, not milestones or spec sections, in comments and test titles", () => {
    const files = CONSENT_PATHS.flatMap(sourceFiles).filter(
      (file) => file !== SELF
    );
    expect(files.length).toBeGreaterThan(10);

    const citations = files.flatMap((file) =>
      readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .flatMap((line, index) =>
          CITATION.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []
        )
    );
    expect(citations).toEqual([]);
  });
});
