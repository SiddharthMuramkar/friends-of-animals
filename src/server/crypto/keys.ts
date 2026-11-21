// Not built yet: the failing tests in ./keys.test.ts describe it.

import type { BlindIndex } from "./blind-index";
import type { FieldCipher } from "./field-cipher";

export function fieldCryptoFor(_env: {
  APP_ENV: "local" | "preview" | "staging" | "production";
  FIELD_ENCRYPTION_KEYS?: string | undefined;
  FIELD_HMAC_KEY?: string | undefined;
}): { cipher: FieldCipher; blindIndex: BlindIndex } {
  throw new Error("fieldCryptoFor is not built yet");
}
