// Where a file's object lives. Production has its own buckets and uses no
// prefix; every other environment shares the non-production buckets under a
// prefix of its own: `staging/`, `local/`, or a preview's `pr-<n>/` or
// `br-<hash>/`. A preview's prefix follows its database's name
// (src/server/db/database-url.ts), so when the sweeper drops that database
// `storagePrefixForDatabase` finds the prefix to purge.
//
// Under the prefix, an object passes through these keys:
//   <prefix>incoming/<id>     where the browser PUTs it: the only key an
//                             upload URL ever names;
//   <prefix><purpose>/<id>    the file's storage key, where completing the
//                             upload moves it, and the only key the scan
//                             reads and downloads serve;
//   <prefix>quarantine/<id>   where a file the scan flagged is moved.
//
// A purpose whose images the public site shows (a post's, #112) also gets
// resized copies in the public bucket beside the private one,
// `<bucket>-public`, at `<prefix>public/<purpose>/<id>/<kind>.webp`. Never
// the original: only derivatives are copied there.
// An upload URL can be used again until it expires, so whatever it sends
// after completing lands in `incoming/` and never reaches the file.
//
// Keys are built only from the prefix, the purpose and the file's UUID:
// never from anything the uploader sent.

import {
  previewDatabaseName,
  type DatabaseEnv,
} from "../../../db/database-url";

import type { DerivativeKind } from "./derivatives";
import type { FilePurpose } from "./purposes";

// Every preview database name ends in `_<fp>`, the migrations fingerprint,
// so a PR or branch may have had several databases. They all map to one
// prefix: the sweeper drops them together, once the PR or branch is gone.
/** `foa_pr_<n>_<fp>`. */
const PR_DATABASE = /^foa_pr_([1-9][0-9]*)_[0-9a-f]{8}$/;
/** `foa_br_<slug>_<hash>_<fp>` or `foa_br_<hash>_<fp>`. */
const BRANCH_DATABASE = /^foa_br_(?:[a-z0-9_]+_)?([0-9a-f]{8})_[0-9a-f]{8}$/;

/** "" or one lower-case folder ending in "/". */
const PREFIX = /^(?:[a-z0-9-]+\/)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The key prefix this environment's files are stored under. */
export function storagePrefixFor(env: DatabaseEnv): string {
  switch (env.APP_ENV) {
    case "production":
      return "";
    case "staging":
      return "staging/";
    case "preview": {
      const prefix = storagePrefixForDatabase(previewDatabaseName(env));
      if (prefix === null) {
        throw new Error("A preview's database name has no storage prefix.");
      }
      return prefix;
    }
    default:
      return "local/";
  }
}

/**
 * The bucket this environment's files go to: R2_BUCKET once R2 is
 * configured. Without it a local run keeps its files in the disk store's
 * own bucket (src/server/ports/storage-disk.ts), and a deployment's storage
 * refuses every call, so its bucket is never used.
 */
export function storageBucketFor(env: {
  APP_ENV?: string | undefined;
  R2_BUCKET?: string | undefined;
}): string {
  if (env.R2_BUCKET) return env.R2_BUCKET;
  switch (env.APP_ENV) {
    case "production":
    case "staging":
    case "preview":
      return "unconfigured";
    default:
      return "local";
  }
}

/**
 * The storage prefix of the preview that owns database `name`, or null if
 * `name` isn't a preview database. Purging must never run on null.
 */
export function storagePrefixForDatabase(name: string): string | null {
  const pr = PR_DATABASE.exec(name);
  if (pr) return `pr-${pr[1]}/`;
  const branch = BRANCH_DATABASE.exec(name);
  if (branch) return `br-${branch[1]}/`;
  return null;
}

function assertSafe(prefix: string, fileId: string): void {
  if (!PREFIX.test(prefix)) {
    throw new Error(`Not a storage prefix: ${JSON.stringify(prefix)}`);
  }
  if (!UUID.test(fileId)) {
    throw new Error(`Not a file id: ${JSON.stringify(fileId)}`);
  }
}

/** Folders of the layout above that no purpose may be named after. */
export const RESERVED_FOLDERS: readonly string[] = [
  "incoming",
  "quarantine",
  "public",
];

/**
 * `<prefix><purpose>/<fileId>`: the file's storage key. No upload URL ever
 * names it, so only completing the upload writes it.
 */
export function storageKeyFor({
  prefix,
  purpose,
  fileId,
}: {
  prefix: string;
  purpose: FilePurpose;
  fileId: string;
}): string {
  assertSafe(prefix, fileId);
  if (RESERVED_FOLDERS.includes(purpose)) {
    throw new Error(`A purpose can't be named ${JSON.stringify(purpose)}`);
  }
  return `${prefix}${purpose}/${fileId}`;
}

/**
 * `<prefix>incoming/<fileId>`: where the browser PUTs the file, the only
 * key an upload URL names. Completing the upload moves it on.
 */
export function uploadKeyFor({
  prefix,
  fileId,
}: {
  prefix: string;
  fileId: string;
}): string {
  assertSafe(prefix, fileId);
  return `${prefix}incoming/${fileId}`;
}

/** The environment prefix a file's storage key, `<prefix><purpose>/<id>`, is under. */
export function storagePrefixOf(file: {
  id: string;
  purpose: FilePurpose;
  storageKey: string;
}): string {
  const suffix = `${file.purpose}/${file.id}`;
  if (!file.storageKey.endsWith(suffix)) {
    throw new Error(`File ${file.id} isn't stored under its purpose`);
  }
  return file.storageKey.slice(0, -suffix.length);
}

/** `<prefix>quarantine/<fileId>`: where a flagged file is moved. */
export function quarantineKeyFor({
  prefix,
  fileId,
}: {
  prefix: string;
  fileId: string;
}): string {
  assertSafe(prefix, fileId);
  return `${prefix}quarantine/${fileId}`;
}

/** A flagged file may still be under its original key if a move failed. */
export function quarantineKeyOf(
  file: Parameters<typeof storagePrefixOf>[0]
): string {
  const suffix = `quarantine/${file.id}`;
  if (file.storageKey.endsWith(suffix)) {
    return quarantineKeyFor({
      prefix: file.storageKey.slice(0, -suffix.length),
      fileId: file.id,
    });
  }
  return quarantineKeyFor({ prefix: storagePrefixOf(file), fileId: file.id });
}

/** An R2 bucket name's longest: 63 characters. */
const BUCKET_MAX = 63;

/**
 * The public bucket beside the private bucket `bucket`: `<bucket>-public`.
 * Only resized copies of images the public site shows are written there.
 */
export function publicBucketFor(bucket: string): string {
  const name = `${bucket}-public`;
  if (name.length > BUCKET_MAX) {
    throw new Error(`Bucket ${JSON.stringify(bucket)} has no room for -public`);
  }
  return name;
}

/**
 * `<prefix>public/<purpose>/<fileId>/<kind>.webp`: a derivative's public
 * copy. Built only from the prefix, the purpose, the file's UUID and the
 * kind, so it can never name the original.
 */
export function publicCopyKeyFor({
  prefix,
  purpose,
  fileId,
  kind,
}: {
  prefix: string;
  purpose: FilePurpose;
  fileId: string;
  kind: DerivativeKind;
}): string {
  assertSafe(prefix, fileId);
  return `${prefix}public/${purpose}/${fileId}/${kind}.webp`;
}
