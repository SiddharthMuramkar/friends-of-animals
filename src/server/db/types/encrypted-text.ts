// A column that holds personal data encrypted by the field cipher
// (src/server/crypto/field-cipher.ts). Its value type is `Ciphertext`, which
// only `cipher.encrypt()` makes, so plain text can't be written into it by
// mistake, and reads come back as ciphertext for `cipher.decrypt()`.
//
// Encryption uses a fresh IV every time, so the same value never stores the
// same way twice and `eq(column, …)` can't find a row by it: store a blind
// index (src/server/crypto/blind-index.ts) beside it and look rows up by
// that.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { customType } from "drizzle-orm/pg-core";

import type { Ciphertext } from "../../crypto/field-cipher";

export const encryptedText = customType<{
  data: Ciphertext;
  driverData: string;
}>({
  dataType: () => "text",
});
