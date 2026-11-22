// Where a production object's copy lives in B2. One B2 bucket holds every
// production bucket's objects, each under the name of the bucket it came
// from, so a restore knows where a copy belongs.

/**
 * The prefixes non-production environments store under in the shared
 * non-production buckets (63a's `storagePrefixFor`): `staging/`, `local/`,
 * `pr-<n>/` and `br-<hash>/`. Production keys have no prefix.
 */
const NON_PRODUCTION_PREFIX = /^(?:staging|local|pr-[0-9]+|br-[0-9a-f]{8})\//;

/** R2's bucket names: 3-63 lower-case letters, digits and inner hyphens. */
export const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** B2 caps a file name at 1024 bytes of UTF-8. */
const MAX_OFFSITE_KEY_BYTES = 1024;

const utf8 = new TextEncoder();

function assertBucket(bucket: string): void {
  if (!BUCKET_NAME.test(bucket)) {
    throw new Error(`Not a bucket name: ${JSON.stringify(bucket)}`);
  }
}

/** `<bucket>/<key>`. Throws for a name or key that can't round-trip. */
export function offsiteKeyFor({
  bucket,
  key,
}: {
  bucket: string;
  key: string;
}): string {
  assertBucket(bucket);
  if (key === "" || key.startsWith("/")) {
    throw new Error(`Not an object key: ${JSON.stringify(key)}`);
  }
  const offsiteKey = `${bucket}/${key}`;
  if (utf8.encode(offsiteKey).length > MAX_OFFSITE_KEY_BYTES) {
    throw new Error(
      `The B2 key for this object would exceed ${MAX_OFFSITE_KEY_BYTES} bytes`
    );
  }
  return offsiteKey;
}

/** The bucket and key a copy came from, or null if it isn't a copy's key. */
export function sourceOfOffsiteKey(
  offsiteKey: string
): { bucket: string; key: string } | null {
  const slash = offsiteKey.indexOf("/");
  if (slash === -1) return null;
  const bucket = offsiteKey.slice(0, slash);
  const key = offsiteKey.slice(slash + 1);
  if (!BUCKET_NAME.test(bucket) || key === "" || key.startsWith("/"))
    return null;
  return { bucket, key };
}

/**
 * The environment prefix `key` starts with, or null for a production key.
 * The copy never sends a key with such a prefix to B2, even if a
 * non-production bucket is listed by mistake.
 */
export function nonProductionPrefixOf(key: string): string | null {
  return NON_PRODUCTION_PREFIX.exec(key)?.[0] ?? null;
}
