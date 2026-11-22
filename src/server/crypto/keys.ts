// The field cipher and blind index for one deployment, from its keys:
// FIELD_ENCRYPTION_KEYS (the versioned key ring) and FIELD_HMAC_KEY. The
// app (src/server/deps.ts) and the seed script (scripts/seed.ts) both build
// theirs here, so a phone the seed stores on a preview is one the app can
// find and read.
//
// Staging and production must set both keys (src/env.schema.ts refuses to
// start without them). A local run or a preview without them uses the
// development keys below, which are public: they protect nothing, so only
// seed and test data may sit under them.
//
// Loads under plain Node (seed script), so no "server-only" here.

import {
  createBlindIndex,
  parseBlindIndexKey,
  type BlindIndex,
} from "./blind-index";
import {
  createFieldCipher,
  parseKeyRing,
  type FieldCipher,
} from "./field-cipher";

/** Public keys for local runs and previews: base64 of readable text. */
export const DEVELOPMENT_FIELD_KEYS = {
  /** "foa-dev-field-key-not-a-secret!!" */
  FIELD_ENCRYPTION_KEYS: "1:Zm9hLWRldi1maWVsZC1rZXktbm90LWEtc2VjcmV0ISE=",
  /** "foa-dev-hmac-key-not-a-secret!!!" */
  FIELD_HMAC_KEY: "Zm9hLWRldi1obWFjLWtleS1ub3QtYS1zZWNyZXQhISE=",
} as const;

export type FieldKeyEnv = {
  APP_ENV: "local" | "preview" | "staging" | "production";
  FIELD_ENCRYPTION_KEYS?: string | undefined;
  FIELD_HMAC_KEY?: string | undefined;
};

export type FieldCrypto = { cipher: FieldCipher; blindIndex: BlindIndex };

/**
 * The cipher and blind index for `env`. Throws on staging or production
 * without both keys, and on a malformed key anywhere.
 */
export function fieldCryptoFor(env: FieldKeyEnv): FieldCrypto {
  const deployed = env.APP_ENV === "staging" || env.APP_ENV === "production";
  if (
    deployed &&
    (env.FIELD_ENCRYPTION_KEYS === undefined ||
      env.FIELD_HMAC_KEY === undefined)
  ) {
    throw new Error(
      `APP_ENV=${env.APP_ENV} needs FIELD_ENCRYPTION_KEYS and FIELD_HMAC_KEY ` +
        "of its own; the development keys are public."
    );
  }
  const keys = deployed
    ? env
    : {
        FIELD_ENCRYPTION_KEYS:
          env.FIELD_ENCRYPTION_KEYS ??
          DEVELOPMENT_FIELD_KEYS.FIELD_ENCRYPTION_KEYS,
        FIELD_HMAC_KEY:
          env.FIELD_HMAC_KEY ?? DEVELOPMENT_FIELD_KEYS.FIELD_HMAC_KEY,
      };
  return {
    cipher: createFieldCipher(parseKeyRing(keys.FIELD_ENCRYPTION_KEYS!)),
    blindIndex: createBlindIndex(parseBlindIndexKey(keys.FIELD_HMAC_KEY!)),
  };
}
