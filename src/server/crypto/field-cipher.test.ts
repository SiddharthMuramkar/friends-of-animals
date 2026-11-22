import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createFieldCipher,
  FieldCipherError,
  KeyRingError,
  parseKeyRing,
} from "./field-cipher";

/** A key ring value as FIELD_ENCRYPTION_KEYS holds it, with fresh keys. */
function keyRingValue(...versions: number[]): string {
  return versions
    .map((version) => `${version}:${randomBytes(32).toString("base64")}`)
    .join(",");
}

describe("createFieldCipher()", () => {
  it("reads back what it stored", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));

    const stored = cipher.encrypt("user.phone", "+919876543210");

    expect(cipher.decrypt("user.phone", stored)).toBe("+919876543210");
  });

  it("stores neither the number nor its last ten digits", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));

    const stored = cipher.encrypt("user.phone", "+919876543210");

    expect(stored).not.toContain("+919876543210");
    expect(stored).not.toContain("9876543210");
  });

  it("stores the same number differently each time", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));

    expect(cipher.encrypt("user.phone", "+919876543210")).not.toBe(
      cipher.encrypt("user.phone", "+919876543210")
    );
  });

  it("still reads values stored under an older key after a new key is added", () => {
    const v1 = keyRingValue(1);
    const before = createFieldCipher(parseKeyRing(v1));
    const stored = before.encrypt("user.phone", "+919876543210");

    const after = createFieldCipher(parseKeyRing(`${keyRingValue(2)},${v1}`));

    expect(after.decrypt("user.phone", stored)).toBe("+919876543210");
  });

  it("stores new values under the newest key", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1, 3, 2)));

    expect(cipher.encrypt("user.phone", "+919876543210")).toMatch(/^v3:/);
  });

  it("refuses a stored value that was changed", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));
    const [version, iv, body, tag] = cipher
      .encrypt("user.phone", "+919876543210")
      .split(":");
    const flipped = `${body!.startsWith("A") ? "B" : "A"}${body!.slice(1)}`;

    expect(() =>
      cipher.decrypt("user.phone", [version, iv, flipped, tag].join(":"))
    ).toThrow(FieldCipherError);
  });

  it("refuses a value stored for another column", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));
    const stored = cipher.encrypt("guardian.phone", "+919876543210");

    expect(() => cipher.decrypt("user.phone", stored)).toThrow(
      FieldCipherError
    );
  });

  it("names the missing key version when a value's key is not in the ring", () => {
    const stored = createFieldCipher(parseKeyRing(keyRingValue(1))).encrypt(
      "user.phone",
      "+919876543210"
    );
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(2)));

    expect(() => cipher.decrypt("user.phone", stored)).toThrow(
      new FieldCipherError("No key with version 1 in FIELD_ENCRYPTION_KEYS")
    );
  });

  it.each(["", "+919876543210", "v1:abc", "v1:a:b:c:d", "x1:a:b:c"])(
    "refuses %j, which is not a stored value",
    (stored) => {
      const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));

      expect(() => cipher.decrypt("user.phone", stored)).toThrow(
        FieldCipherError
      );
    }
  );

  it("never puts the stored value in an error message", () => {
    const cipher = createFieldCipher(parseKeyRing(keyRingValue(1)));

    expect(() => cipher.decrypt("user.phone", "+919876543210")).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("9876543210"),
      })
    );
  });
});

describe("parseKeyRing()", () => {
  const key = () => randomBytes(32).toString("base64");

  it("encrypts with the highest version and keeps every key for reading", () => {
    const ring = parseKeyRing(` 2:${key()} , 1:${key()} `);

    expect(ring.primary).toBe(2);
    expect(new Set(ring.keys.keys())).toEqual(new Set([1, 2]));
  });

  it.each([
    ["", "FIELD_ENCRYPTION_KEYS is empty"],
    [" , ", "FIELD_ENCRYPTION_KEYS is empty"],
    ["no-colon", 'Each FIELD_ENCRYPTION_KEYS entry is "<version>:<key>"'],
    ["0:K", "Key versions in FIELD_ENCRYPTION_KEYS are whole numbers from 1"],
    ["v1:K", "Key versions in FIELD_ENCRYPTION_KEYS are whole numbers from 1"],
    ["1.5:K", "Key versions in FIELD_ENCRYPTION_KEYS are whole numbers from 1"],
    [
      "1:c2hvcnQ=",
      "Key version 1 in FIELD_ENCRYPTION_KEYS is not 32 bytes of base64; " +
        "make one with `openssl rand -base64 32`",
    ],
  ])("refuses %j", (value, message) => {
    expect(() => parseKeyRing(value.replace(/K$/, key()))).toThrow(
      new KeyRingError(message)
    );
  });

  it("refuses a key with characters base64 does not use", () => {
    const bad = `${key().slice(0, 40)}!!!=`;

    expect(() => parseKeyRing(`1:${bad}`)).toThrow(KeyRingError);
  });

  it("refuses two keys with one version", () => {
    expect(() => parseKeyRing(`1:${key()},1:${key()}`)).toThrow(
      new KeyRingError("Key version 1 appears twice in FIELD_ENCRYPTION_KEYS")
    );
  });

  it("never puts a key in an error message", () => {
    const secret = key();
    let message = "";
    try {
      parseKeyRing(`1:${secret},1:${secret}`);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain(secret);
  });
});
