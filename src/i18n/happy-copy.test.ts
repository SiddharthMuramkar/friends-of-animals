import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { fleschKincaidGrade } from "@/content/stories/text";

// Copy around the happy dog and cat photos (HappyMosaic). Notes are
// handwritten in Kalam, so five words at most (DIRECTION §2); the lines
// children read stay at grade 6 or below (DIRECTION §1).
const DIR = path.join(process.cwd(), "messages", "en-IN");
type Tree = { [k: string]: string | Tree };
const read = (ns: string) =>
  (JSON.parse(readFileSync(path.join(DIR, `${ns}.json`), "utf8")) as Tree)[
    ns
  ] as Tree;
const at = (tree: Tree, keys: string): Tree =>
  keys.split(".").reduce((t, k) => t[k] as Tree, tree);
const strings = (tree: Tree, skip: string[] = []) =>
  Object.entries(tree)
    .filter(([k]) => !skip.includes(k))
    .map(([, v]) => v as string);

const NOTES = {
  "home.joy.photos": strings(at(read("home"), "joy.photos")),
  "competitions.draw.prompts": strings(
    at(read("competitions"), "draw.prompts")
  ),
  "about.how.photos": strings(at(read("about"), "how.photos"), ["title"]),
  "awareness.pledge.photos": strings(at(read("awareness"), "pledge.photos")),
};

describe("happy photo copy", () => {
  it.each(Object.entries(NOTES))("%s notes are 5 words or fewer", (_, list) => {
    expect(list.length).toBeGreaterThan(0);
    for (const note of list) {
      expect(note.split(/\s+/).length, note).toBeLessThanOrEqual(5);
      expect(note, note).not.toMatch(/!/);
    }
  });

  it("keeps the drawing-prompt lead and notes at grade 6 or below", () => {
    const draw = at(read("competitions"), "draw");
    const kid = [
      draw.title as string,
      draw.lead as string,
      ...Object.values(NOTES).flat(),
    ].join("\n");
    expect(fleschKincaidGrade(kid)).toBeLessThanOrEqual(6);
    expect(fleschKincaidGrade(draw.lead as string)).toBeLessThanOrEqual(6);
  });
});
