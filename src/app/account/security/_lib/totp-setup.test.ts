import { encode } from "uqr";
import { describe, expect, it } from "vitest";

import { groupKey, qrCode } from "./totp-setup";

describe("groupKey", () => {
  it("splits a setup key into groups of four, for reading aloud and typing", () => {
    expect(groupKey("FOAPREVIEWSEEDTOTPSECRETKEY23456")).toBe(
      "FOAP REVI EWSE EDTO TPSE CRET KEY2 3456"
    );
    expect(groupKey("ABCDEF")).toBe("ABCD EF");
  });
});

describe("qrCode", () => {
  const uri =
    "otpauth://totp/Friends%20of%20Animals:a%40example.test?secret=ABCD&issuer=Friends%20of%20Animals";

  it("draws one square per dark module, inside a four-module quiet zone", () => {
    const { data, size } = encode(uri, { ecc: "M", border: 0 });
    const code = qrCode(uri);
    const dark = data.flat().filter(Boolean).length;

    expect(code.size).toBe(size + 8);
    expect(code.path.match(/M/g)).toHaveLength(dark);
    // The top-left finder pattern's corner module sits at (4, 4).
    expect(code.path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
