import { afterEach, describe, expect, it, vi } from "vitest";

import { cachedConsentDocument } from "@/server/modules/consent/cached";

import { MessagesConsentField } from "./messages-consent-field";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/modules/consent/cached", () => ({
  cachedConsentDocument: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MessagesConsentField", () => {
  it("leaves the optional box out, and logs why, when the database can't be read", async () => {
    vi.mocked(cachedConsentDocument).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED")
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await MessagesConsentField()).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("could not read the messages consent")
    );
  });

  it("leaves the box out while no version is published", async () => {
    vi.mocked(cachedConsentDocument).mockResolvedValueOnce(null);

    expect(await MessagesConsentField()).toBeNull();
  });
});
