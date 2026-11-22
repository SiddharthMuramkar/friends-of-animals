import { afterEach, describe, expect, it, vi } from "vitest";

import { nullIfUnreadable } from "./unreadable";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nullIfUnreadable", () => {
  it("gives what the read gives", async () => {
    expect(
      await nullIfUnreadable("Page", async () => ({ version: 2 }))
    ).toEqual({ version: 2 });
    expect(await nullIfUnreadable("Page", async () => null)).toBeNull();
  });

  it("gives null and logs where, when the database can't be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await nullIfUnreadable("Sign-up form: the messages consent", async () => {
        throw new Error("connect ECONNREFUSED");
      })
    ).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("Sign-up form: the messages consent: ")
    );
  });
});
