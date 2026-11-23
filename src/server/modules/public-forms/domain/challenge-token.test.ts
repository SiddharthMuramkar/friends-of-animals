import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CHALLENGE_LIFETIME_MS,
  challengeAge,
  decodeChallengeToken,
  encodeChallengeToken,
  type ChallengeMac,
} from "./challenge-token";

// A test key; the adapter keys this with FIELD_HMAC_KEY.
const mac: ChallengeMac = (data) =>
  createHmac("sha256", "test-key").update(data).digest("base64url");
const otherMac: ChallengeMac = (data) =>
  createHmac("sha256", "other-key").update(data).digest("base64url");

const CHALLENGE = {
  salt: "q7Yv3mJf0kZ8xN2pL5sT1w",
  issuedAt: new Date("2027-01-15T04:30:00.000Z"),
  difficulty: 16,
};

describe("challenge tokens", () => {
  it("decodes what it encoded", () => {
    const token = encodeChallengeToken(CHALLENGE, mac);
    expect(token.startsWith("v1.")).toBe(true);
    expect(decodeChallengeToken(token, mac)).toEqual(CHALLENGE);
  });

  it("refuses a token signed with another key", () => {
    const token = encodeChallengeToken(CHALLENGE, otherMac);
    expect(decodeChallengeToken(token, mac)).toBeNull();
  });

  it("refuses a token whose parts were changed", () => {
    const token = encodeChallengeToken(CHALLENGE, mac);
    const parts = token.split(".");
    const tampered = [
      [parts[0], "AAAAAAAAAAAAAAAAAAAAAA", ...parts.slice(2)],
      [
        ...parts.slice(0, 2),
        String(Number(parts[2]) + 60_000),
        ...parts.slice(3),
      ],
      [...parts.slice(0, 3), "1", parts[4]],
      [...parts.slice(0, 4), `${parts[4]}x`],
    ];
    for (const changed of tampered) {
      expect(decodeChallengeToken(changed.join("."), mac)).toBeNull();
    }
  });

  it("refuses tokens that aren't in the format", () => {
    for (const token of [
      "",
      "v1",
      "v2.q7Yv3mJf0kZ8xN2pL5sT1w.1800000000000.16.abc",
      "v1.short.1800000000000.16.abc",
      "v1.q7Yv3mJf0kZ8xN2pL5sT1w.soon.16.abc",
      "v1.q7Yv3mJf0kZ8xN2pL5sT1w.1800000000000.99.abc",
      "v1.q7Yv3mJf0kZ8xN2pL5sT1w.1800000000000.16.abc.extra",
    ]) {
      expect(decodeChallengeToken(token, mac)).toBeNull();
    }
  });

  it("refuses to encode a challenge the decoder would refuse", () => {
    expect(() =>
      encodeChallengeToken({ ...CHALLENGE, salt: "has.dot" }, mac)
    ).toThrow(RangeError);
    expect(() =>
      encodeChallengeToken({ ...CHALLENGE, difficulty: 40 }, mac)
    ).toThrow(RangeError);
  });
});

describe("challenge age", () => {
  const at = (ms: number) => new Date(CHALLENGE.issuedAt.getTime() + ms);

  it("lasts two hours, long enough to write a long message", () => {
    expect(CHALLENGE_LIFETIME_MS).toBe(2 * 3_600_000);
    expect(challengeAge(CHALLENGE, at(CHALLENGE_LIFETIME_MS))).toBe("fresh");
    expect(challengeAge(CHALLENGE, at(CHALLENGE_LIFETIME_MS + 1))).toBe(
      "expired"
    );
  });

  it("treats a challenge from the future as expired", () => {
    expect(challengeAge(CHALLENGE, at(-1))).toBe("expired");
  });
});
