// The CopyBucket contract against a real bucket: B2 or R2, through the S3
// adapter. Not part of `pnpm test`: it needs a bucket that holds nothing
// else of value and a key for it (owner residue HR-25, HR-13). Run it by
// hand, alone:
//
//   OFFSITE_CONTRACT=1 OFFSITE_CONTRACT_ENDPOINT=https://s3.<region>.backblazeb2.com \
//   OFFSITE_CONTRACT_REGION=<region> OFFSITE_CONTRACT_BUCKET=… \
//   OFFSITE_CONTRACT_KEY_ID=… OFFSITE_CONTRACT_SECRET=… \
//     pnpm test:live src/server/ports/copy-bucket-s3.live.test.ts
//
// Add OFFSITE_CONTRACT_SSE=AES256 for B2 (SSE-B2). Each run works under a
// folder of its own and deletes it at the end.

import { randomUUID } from "node:crypto";

import { afterAll } from "vitest";

import { copyBucketContract } from "./copy-bucket.contract";
import { s3CopyBucket } from "./copy-bucket-s3";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The live contract needs a bucket of its own ` +
        "and a key scoped to it (see the comment at the top of this file)."
    );
  }
  return value;
}

if (process.env.OFFSITE_CONTRACT !== "1") {
  throw new Error(
    "Set OFFSITE_CONTRACT=1 to run the copy-bucket contract against a real bucket."
  );
}

const bucket = required("OFFSITE_CONTRACT_BUCKET");
const store = s3CopyBucket({
  endpoint: required("OFFSITE_CONTRACT_ENDPOINT"),
  region: required("OFFSITE_CONTRACT_REGION"),
  accessKeyId: required("OFFSITE_CONTRACT_KEY_ID"),
  secretAccessKey: required("OFFSITE_CONTRACT_SECRET"),
  ...(process.env.OFFSITE_CONTRACT_SSE === "AES256"
    ? { serverSideEncryption: "AES256" as const }
    : {}),
});
const run = `contract-${randomUUID()}/`;
let tests = 0;

afterAll(async () => {
  for await (const { key } of store.list({ bucket, prefix: run })) {
    await store.delete({ bucket, key });
  }
});

copyBucketContract("s3CopyBucket (live)", async () => {
  tests += 1;
  return { store, bucket, prefix: `${run}t${tests}/` };
});
