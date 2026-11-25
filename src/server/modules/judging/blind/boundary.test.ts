import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

// The identity-bearing schema and modules are outside the blind projection.
// The conflict checker and age-group label helper return only the facts
// the read model needs; imported schema barrel bindings are checked too.
function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? sources(join(path, item.name))
      : item.name.endsWith(".ts")
        ? [join(path, item.name)]
        : []
  );
}
describe("the blind judging import boundary", () => {
  it("never imports registration, profile, institution or guardian records", () => {
    for (const file of sources(new URL(".", import.meta.url).pathname)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g
      )) {
        expect(match[2], file).not.toMatch(
          /\/(registration|participants|institutions|guardians)(\/|$)/
        );
        if (match[2]?.includes("db/schema"))
          expect(match[1], file).not.toMatch(
            /\b(registration|participantProfile|institution|institutionRegistration|guardian|guardianLink|user)\b/
          );
      }
    }
  });
});
