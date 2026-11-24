import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// A server action returning the same validation error as the use case
// still breaks the boundary contract if it dispatched the unchecked data.
it.each([
  ["placeHoldAction", "placeLegalHoldInput", "placeLegalHold"],
  ["releaseHoldAction", "releaseLegalHoldInput", "releaseLegalHold"],
])(
  "validates FormData at the %s boundary before dispatch",
  (action, schema, useCase) => {
    const source = readFileSync(
      new URL("./actions.ts", import.meta.url),
      "utf8"
    );
    const body = source
      .split(`export async function ${action}(`)[1]
      ?.split("export async function ")[0];
    expect(body).toMatch(
      new RegExp(
        `const parsed = ${schema}\\.safeParse\\(\\{[\\s\\S]+?form\\.get\\([\\s\\S]+?if \\(!parsed\\.success\\)[\\s\\S]+?app\\.${useCase}\\(parsed\\.data\\)`
      )
    );
  }
);
