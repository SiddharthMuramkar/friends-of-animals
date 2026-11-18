import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator, IntlErrorCode } from "next-intl";
import { describe, expect, it } from "vitest";

import { NAMESPACES } from "./messages";

const DIR = path.join(process.cwd(), "messages", "en-IN");

// DIRECTION §4 and the slop ban list (briefs/00-context.md).
const BANNED = [
  /make a difference/i,
  /furry friends?/i,
  /together we can/i,
  /join us on (this|our) journey/i,
  /passionate about/i,
  /dedicated to/i,
  /\bdelve\b/i,
  /tapestry/i,
  /\btestament\b/i,
  /in today'?s world/i,
  /it'?s important to note/i,
  /\bwhether you'?re\b/i,
  /\bvoiceless\b/i,
  /\bunlock\b/i,
  /\bempower/i,
];

type Tree = { [k: string]: string | Tree };
const leaves = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v]] : leaves(v, `${prefix}${k}.`)
  );

describe("messages/en-IN", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

  it("has exactly one file per registered namespace", () => {
    expect(files.map((f) => f.replace(/\.json$/, "")).toSorted()).toEqual(
      [...NAMESPACES].toSorted()
    );
  });

  for (const file of files) {
    const tree = JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as Tree;

    it(`${file}: holds one namespace named after the file`, () => {
      expect(Object.keys(tree)).toEqual([file.replace(/\.json$/, "")]);
    });

    it(`${file}: valid ICU, no empty strings, no banned phrases`, () => {
      const invalid: string[] = [];
      const t = createTranslator({
        locale: "en-IN",
        messages: tree,
        timeZone: "Asia/Kolkata",
        onError: (e) => {
          if (e.code === IntlErrorCode.INVALID_MESSAGE) invalid.push(e.message);
        },
        getMessageFallback: ({ key }) => key,
      });
      for (const [key, value] of leaves(tree)) {
        expect(value.trim(), key).not.toBe("");
        for (const re of BANNED) expect(value, key).not.toMatch(re);
        t(key as never, {} as never);
      }
      expect(invalid).toEqual([]);
    });
  }
});
