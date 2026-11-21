import { describe, expect, it } from "vitest";

import {
  leadingZeroBits,
  MAX_DIFFICULTY,
  solveProofOfWork,
  verifyProofOfWork,
} from "./proof-of-work";

const SALT = "q7Yv3mJf0kZ8xN2pL5sT1w";

describe("leading zero bits", () => {
  it("counts zero bits from the most significant end", () => {
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x40]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x10]))).toBe(11);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16);
    expect(leadingZeroBits(new Uint8Array([]))).toBe(0);
  });
});

describe("proof of work", () => {
  it("finds a nonce that the check then accepts", async () => {
    const nonce = await solveProofOfWork({ salt: SALT, difficulty: 8 });
    expect(Number.isSafeInteger(nonce)).toBe(true);
    await expect(
      verifyProofOfWork({ salt: SALT, difficulty: 8, nonce })
    ).resolves.toBe(true);
  });

  it("finds the first such nonce, so the work can't be skipped", async () => {
    const nonce = await solveProofOfWork({ salt: SALT, difficulty: 6 });
    for (let earlier = 0; earlier < nonce; earlier++) {
      await expect(
        verifyProofOfWork({ salt: SALT, difficulty: 6, nonce: earlier })
      ).resolves.toBe(false);
    }
  });

  it("ties the proof to its salt", async () => {
    const nonce = await solveProofOfWork({ salt: SALT, difficulty: 10 });
    await expect(
      verifyProofOfWork({ salt: `${SALT}x`, difficulty: 10, nonce })
    ).resolves.toBe(false);
  });

  it("accepts any nonce at difficulty 0", async () => {
    await expect(
      verifyProofOfWork({ salt: SALT, difficulty: 0, nonce: 0 })
    ).resolves.toBe(true);
  });

  it("refuses a nonce that isn't a whole number from 0 up", async () => {
    for (const nonce of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        verifyProofOfWork({ salt: SALT, difficulty: 0, nonce })
      ).resolves.toBe(false);
    }
  });

  it("refuses a difficulty outside 0 to the maximum", async () => {
    expect(MAX_DIFFICULTY).toBe(24);
    await expect(
      verifyProofOfWork({ salt: SALT, difficulty: 25, nonce: 0 })
    ).rejects.toThrow(RangeError);
    await expect(
      solveProofOfWork({ salt: SALT, difficulty: -1 })
    ).rejects.toThrow(RangeError);
  });

  it("stops when asked to", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      solveProofOfWork({
        salt: SALT,
        difficulty: 20,
        signal: controller.signal,
      })
    ).rejects.toThrow();
  });
});
