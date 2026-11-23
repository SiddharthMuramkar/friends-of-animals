import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Repo rule: code comments and test titles cite issues (#111), never spec
// sections or milestone names, which go stale as plans move. This guards
// the CMS module and the pages and components that only it serves.

const root = path.join(import.meta.dirname, "../../../..");

const CMS_PATHS = [
  "src/server/modules/cms",
  "src/server/seed/cms.ts",
  "src/app/(staff)/admin/cms",
  "src/app/_components/cms-draft-preview.tsx",
  "src/components/site/live.tsx",
  "tests/e2e/111-cms.spec.ts",
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

describe("CMS sources", () => {
  it("cite issues, not milestones or spec sections, in comments and test titles", () => {
    const files = CMS_PATHS.flatMap(sourceFiles).filter(
      (file) => file !== SELF
    );
    expect(files.length).toBeGreaterThan(30);

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
