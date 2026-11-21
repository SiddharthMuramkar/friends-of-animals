import { describe, expect, it } from "vitest";

import type { ConsentStatus } from "./audience-plan";
import {
  ONE_CLICK_BODY,
  decideUnsubscribe,
  isOneClickUnsubscribe,
  listUnsubscribeHeaders,
  unsubscribeLinks,
} from "./unsubscribe";

// A 43-character base64url token, as a 32-byte link token encodes.
const TOKEN = "AbC-123_xyzAbC-123_xyzAbC-123_xyzAbC-123_xy";

const given = (eventId: string, giverUserId: string): ConsentStatus => ({
  status: "given",
  eventId,
  giverUserId,
});
const withdrawn = (eventId: string, giverUserId: string): ConsentStatus => ({
  status: "withdrawn",
  eventId,
  giverUserId,
});

describe("unsubscribeLinks", () => {
  it("builds the confirm page and one-click links on the site's origin", () => {
    expect(unsubscribeLinks("https://foa.example", TOKEN)).toEqual({
      page: `https://foa.example/unsubscribe/${TOKEN}`,
      oneClick: `https://foa.example/api/unsubscribe/${TOKEN}`,
    });
  });

  it("ignores a path or trailing slash on the site URL", () => {
    expect(unsubscribeLinks("https://foa.example/en/", TOKEN).page).toBe(
      `https://foa.example/unsubscribe/${TOKEN}`
    );
  });

  it.each(["", "a/b", "../admin", "a b", "a%2Fb", "tok?x=1"])(
    "refuses the token %j",
    (token) => {
      expect(() => unsubscribeLinks("https://foa.example", token)).toThrow(
        RangeError
      );
    }
  );

  it("refuses a site URL that isn't http or https", () => {
    expect(() => unsubscribeLinks("mailto:x@foa.example", TOKEN)).toThrow(
      RangeError
    );
  });
});

describe("listUnsubscribeHeaders", () => {
  it("sends the RFC 8058 pair for an HTTPS link", () => {
    const { oneClick } = unsubscribeLinks("https://foa.example", TOKEN);
    expect(listUnsubscribeHeaders(oneClick)).toEqual({
      "List-Unsubscribe": `<https://foa.example/api/unsubscribe/${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("allows plain HTTP only on a local host", () => {
    expect(
      listUnsubscribeHeaders(`http://localhost:3000/api/unsubscribe/${TOKEN}`)[
        "List-Unsubscribe"
      ]
    ).toBe(`<http://localhost:3000/api/unsubscribe/${TOKEN}>`);
    expect(() =>
      listUnsubscribeHeaders(`http://foa.example/api/unsubscribe/${TOKEN}`)
    ).toThrow(RangeError);
  });

  it("refuses something that isn't a URL", () => {
    expect(() => listUnsubscribeHeaders("not a url")).toThrow();
  });
});

describe("isOneClickUnsubscribe", () => {
  it("accepts the RFC 8058 body, urlencoded or multipart", () => {
    expect(isOneClickUnsubscribe(new URLSearchParams(ONE_CLICK_BODY))).toBe(
      true
    );
    const form = new FormData();
    form.set("List-Unsubscribe", "One-Click");
    expect(isOneClickUnsubscribe(form)).toBe(true);
  });

  it.each(["", "List-Unsubscribe=Yes", "list-unsubscribe=One-Click", "x=1"])(
    "refuses the body %j",
    (body) => {
      expect(isOneClickUnsubscribe(new URLSearchParams(body))).toBe(false);
    }
  );
});

describe("decideUnsubscribe", () => {
  it("withdraws the recipient's own consent and each child's", () => {
    expect(
      decideUnsubscribe([
        {
          purpose: "messages",
          subjectUserId: "u-mum",
          current: given("e1", "u-mum"),
        },
        {
          purpose: "communications",
          subjectProfileId: "p-kid1",
          current: given("e2", "u-mum"),
        },
        {
          purpose: "communications",
          subjectProfileId: "p-kid2",
          current: given("e3", "u-mum"),
        },
      ])
    ).toEqual({
      changed: true,
      withdraw: [
        { purpose: "messages", subjectType: "user", subjectId: "u-mum" },
        {
          purpose: "communications",
          subjectType: "participant_profile",
          subjectId: "p-kid1",
        },
        {
          purpose: "communications",
          subjectType: "participant_profile",
          subjectId: "p-kid2",
        },
      ],
    });
  });

  it("skips what is already withdrawn or was never given", () => {
    expect(
      decideUnsubscribe([
        {
          purpose: "messages",
          subjectUserId: "u-mum",
          current: withdrawn("e4", "u-mum"),
        },
        {
          purpose: "communications",
          subjectProfileId: "p-kid1",
          current: { status: "never" },
        },
        {
          purpose: "communications",
          subjectProfileId: "p-kid2",
          current: given("e3", "u-mum"),
        },
      ]).withdraw
    ).toEqual([
      {
        purpose: "communications",
        subjectType: "participant_profile",
        subjectId: "p-kid2",
      },
    ]);
  });

  it("withdraws a child's consent even if another guardian re-gave it", () => {
    // The safe side: the person asking to stop always stops the messages.
    expect(
      decideUnsubscribe([
        {
          purpose: "communications",
          subjectProfileId: "p-kid",
          current: given("e9", "u-dad"),
        },
      ]).changed
    ).toBe(true);
  });

  it("changes nothing the second time", () => {
    expect(
      decideUnsubscribe([
        {
          purpose: "messages",
          subjectUserId: "u-mum",
          current: withdrawn("e5", "u-mum"),
        },
      ])
    ).toEqual({ withdraw: [], changed: false });
  });

  it("lists a consent once even if two bases name it", () => {
    const basis = {
      purpose: "messages",
      subjectUserId: "u-mum",
      current: given("e1", "u-mum"),
    } as const;
    expect(decideUnsubscribe([basis, basis]).withdraw).toHaveLength(1);
  });
});
