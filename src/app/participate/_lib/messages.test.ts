import { describe, expect, it } from "vitest";

import en from "../../../../messages/en-IN/participant.json";

// The route chooser and the individual register form both show the note
// that entering through a school is encouraged, and why, from these keys.
describe("the 'enter through your school' note", () => {
  it("has a title, the reason, what to do and where to read more", () => {
    const note = en.participant.schoolNote;

    expect(note.title).toMatch(/through your school/);
    expect(note.body.trim()).not.toBe("");
    expect(note.ask.trim()).not.toBe("");
    expect(note.link.trim()).not.toBe("");
  });
});

describe("the individual register form", () => {
  it("tells a minor to come back when the guardian route opens", () => {
    expect(en.participant.register.minor).toMatch(/come back/i);
    expect(en.participant.register.minor).toMatch(/guardian/);
  });
});
