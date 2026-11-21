import { describe, expect, it } from "vitest";

import {
  checkSocialCaption,
  composeSocialPost,
  creditLine,
  normaliseSocialCaption,
  SOCIAL_POST_MAX,
} from "./caption";

describe("normaliseSocialCaption", () => {
  it("keeps paragraphs, trims each line and collapses spaces", () => {
    expect(
      normaliseSocialCaption(
        "  A tiger at dusk.  \r\n\r\n\r\n  Drawn  in\tink. "
      )
    ).toBe("A tiger at dusk.\n\nDrawn in ink.");
  });

  it("drops control characters and bidi overrides but keeps joiners", () => {
    // U+202E would make the rest of the line read backwards.
    expect(normaliseSocialCaption("Owl\u202E night\u0007")).toBe("Owl night");
    // A ZWJ emoji sequence and a Devanagari conjunct with ZWJ survive.
    expect(normaliseSocialCaption("👩\u200D🎨 क्\u200Dष")).toBe(
      "👩\u200D🎨 क्\u200Dष"
    );
  });

  it("composes to NFC", () => {
    expect(normaliseSocialCaption("Cafe\u0301")).toBe("Café");
  });
});

describe("creditLine", () => {
  it("puts the prefix before the name", () => {
    expect(creditLine({ name: "Asha K." }, "Art by")).toBe("Art by Asha K.");
  });

  it("adds school and city only when the credit carries them", () => {
    expect(
      creditLine(
        { name: "Asha K.", school: "Delhi Public School", city: "Pune" },
        "Art by"
      )
    ).toBe("Art by Asha K., Delhi Public School, Pune");
    expect(creditLine({ name: "Asha K.", city: "Pune" }, "Art by")).toBe(
      "Art by Asha K., Pune"
    );
  });

  it("works without a prefix", () => {
    expect(creditLine({ name: "Ravi Iyer" }, "  ")).toBe("Ravi Iyer");
  });
});

describe("composeSocialPost", () => {
  it("puts the credit after the caption, a blank line apart", () => {
    expect(
      composeSocialPost({
        caption: "A tiger at dusk.",
        creditLine: "Art by Asha K.",
      })
    ).toEqual({
      text: "A tiger at dusk.\n\nArt by Asha K.",
      length: 32,
      overLimit: false,
    });
  });

  it("flags a post whose credit has grown past the limit since the caption was saved", () => {
    const post = composeSocialPost({
      caption: "a".repeat(2190),
      creditLine: "Art by Asha K., Pune",
    });
    expect(post.overLimit).toBe(true);
    expect(post.text.endsWith("Art by Asha K., Pune")).toBe(true);
  });
});

describe("checkSocialCaption", () => {
  // 2200 (the whole post) - 2 (blank line) - 14 ("Art by Asha K.") = 2184.
  const credit = "Art by Asha K.";

  it("limits the whole post to 2200", () => {
    expect(SOCIAL_POST_MAX).toBe(2200);
  });

  it("accepts a caption that fills the post exactly", () => {
    const caption = "a".repeat(2184);
    expect(checkSocialCaption(caption, credit)).toEqual({
      ok: true,
      value: caption,
    });
  });

  it("refuses one character more, saying how long the caption may be", () => {
    expect(checkSocialCaption("a".repeat(2185), credit)).toEqual({
      ok: false,
      problem: "caption_too_long",
      max: 2184,
    });
  });

  it("counts code points, so a Devanagari vowel sign counts on its own", () => {
    // "शा" is one grapheme but two code points.
    expect(checkSocialCaption("शा".repeat(1092), credit).ok).toBe(true);
    expect(checkSocialCaption(`${"शा".repeat(1092)}श`, credit)).toMatchObject({
      ok: false,
      problem: "caption_too_long",
    });
  });

  it("checks the normalised caption, not what was typed", () => {
    expect(checkSocialCaption(`  ${"a".repeat(2184)}  \n\n\n`, credit)).toEqual(
      {
        ok: true,
        value: "a".repeat(2184),
      }
    );
  });

  it("refuses a caption that is empty once normalised", () => {
    expect(checkSocialCaption(" \n\t\u202E ", credit)).toEqual({
      ok: false,
      problem: "caption_empty",
    });
  });
});
