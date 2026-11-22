// The ObjectStorage contract against a real R2 bucket. Not part of
// `pnpm test`: it needs a non-production bucket and a token for it (owner
// residue HR-06). Run it by hand with
//
//   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
//     pnpm test:live
//
// Each run works under a folder of its own and deletes it at the end.

import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";

import { systemClock } from "./clock";
import { objectStorageContract } from "./storage.contract";
import { r2Storage } from "./storage-r2";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The live contract needs a non-production R2 ` +
        "bucket and a token scoped to it (HR-06)."
    );
  }
  return value;
}

const bucket = required("R2_BUCKET");
const storage = r2Storage(
  {
    accountId: required("R2_ACCOUNT_ID"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
  systemClock
);
const run = `contract-${randomUUID()}/`;
let tests = 0;

afterAll(async () => {
  await storage.deletePrefix({ bucket, prefix: run });
});

objectStorageContract("r2Storage (live)", async () => {
  tests += 1;
  return {
    storage,
    bucket,
    prefix: `${run}t${tests}/`,
    upload: async (url, headers, bytes) =>
      (await fetch(url, { method: "PUT", headers, body: bytes.slice() })).ok,
    download: async (url) => {
      const response = await fetch(url);
      if (!response.ok) return null;
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type"),
        contentDisposition: response.headers.get("content-disposition"),
        cacheControl: response.headers.get("cache-control"),
      };
    },
    wait: (seconds) =>
      new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
  };
});
