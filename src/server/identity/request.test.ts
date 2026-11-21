import { describe, expect, it } from "vitest";

import { headersFor, requestMeta } from "./request";

describe("requestMeta", () => {
  it("takes the client's IP, the first x-forwarded-for entry", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 198.51.100.1, 10.0.0.1",
      "user-agent": "Mozilla/5.0",
    });

    expect(requestMeta(headers)).toEqual({
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0",
    });
  });

  it("trims spaces around the address", () => {
    const headers = new Headers({
      "x-forwarded-for": "  2001:db8::1 ,10.0.0.1",
    });

    expect(requestMeta(headers).ip).toBe("2001:db8::1");
  });

  it("says unknown without the header, or with an empty first entry", () => {
    expect(requestMeta(new Headers())).toEqual({
      ip: "unknown",
      userAgent: "",
    });
    expect(
      requestMeta(new Headers({ "x-forwarded-for": " , 10.0.0.1" })).ip
    ).toBe("unknown");
  });
});

describe("headersFor", () => {
  it("rebuilds what requestMeta reads, and the cookie if given", () => {
    const meta = { ip: "203.0.113.10", userAgent: "Mozilla/5.0" };
    const headers = headersFor(meta, "foa.session_token=abc");

    expect(requestMeta(headers)).toEqual(meta);
    expect(headers.get("cookie")).toBe("foa.session_token=abc");
    expect(headersFor(meta).has("cookie")).toBe(false);
  });
});
