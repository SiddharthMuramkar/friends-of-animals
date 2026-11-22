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
  it("tells a minor on their own that a parent or guardian confirms (#81)", () => {
    const { refusal, guardian } = en.participant.register;
    expect(refusal.guardian_details_required).toMatch(/under 18/);
    expect(refusal.guardian_details_required).toMatch(/parent or guardian/);
    expect(guardian.lead).toMatch(/email them a link/);
  });

  it("tells a child under 13 that a parent or guardian registers them (#81)", () => {
    expect(en.participant.register.refusal.under_13_needs_guardian).toMatch(
      /under 13 are registered by a parent or guardian/
    );
  });
});
