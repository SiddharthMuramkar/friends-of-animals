// The idempotency key of a stamped copy. One stamped copy exists per
// (source, variant, settings key): asking again with the same settings
// reuses it and never calls the image processor twice. The key covers
// everything that changes the pixels: the pipeline version, the variant's
// rules, the geometry and contrast defaults, every approved logo file's
// checksum and, for a certificate card, what it says. Changing any of them
// (FOA signs off new placement, a logo file is regenerated, a credit
// changes) gives a new key, so the next request makes a fresh copy.
//
// Pure: no I/O, no "server-only".

import { createHash } from "node:crypto";

import { LOGO_THRESHOLDS, type LogoVariant } from "./logo-choice";
import {
  STAMP_GEOMETRY,
  STAMP_VARIANTS,
  type StampVariant,
} from "./stamp-plan";

/** Raise when the adapter's drawing changes in a way the rules don't show. */
export const STAMP_PIPELINE_VERSION = 1;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** JSON with object keys sorted at every level, so key order never matters. */
function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function stampSettingsKey(input: {
  variant: StampVariant;
  /** SHA-256 of each approved logo file, as the brand registry records it. */
  logoChecksums: Readonly<Record<LogoVariant, string>>;
  /** What a generated card says (certificate share); none for photos. */
  content?: Readonly<Record<string, string | number | null>>;
}): string {
  for (const [variant, checksum] of Object.entries(input.logoChecksums)) {
    if (!SHA256_HEX.test(checksum)) {
      throw new RangeError(
        `The ${variant} logo's checksum must be a SHA-256 hex digest`
      );
    }
  }
  const settings: Json = {
    pipeline: STAMP_PIPELINE_VERSION,
    variant: input.variant,
    rule: STAMP_VARIANTS[input.variant],
    geometry: STAMP_GEOMETRY,
    thresholds: LOGO_THRESHOLDS,
    logos: { ...input.logoChecksums },
    content: { ...input.content },
  };
  return createHash("sha256").update(canonicalJson(settings)).digest("hex");
}
