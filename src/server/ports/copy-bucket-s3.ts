// The S3-API adapter for CopyBucket: R2 (the production buckets) and
// Backblaze B2 (the copies) both speak it.

import type { S3ClientConfig } from "@aws-sdk/client-s3";

import type { CopyBucket } from "./copy-bucket";

export type S3BucketConfig = {
  /** e.g. https://<account>.r2.cloudflarestorage.com or B2's S3 endpoint. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** B2: "AES256" asks for SSE-B2 on every write. R2 encrypts anyway. */
  serverSideEncryption?: "AES256";
};

export function s3CopyBucket(
  _config: S3BucketConfig,
  _requestHandler?: S3ClientConfig["requestHandler"]
): CopyBucket {
  const refuse = () => Promise.reject(new Error("not implemented"));
  return {
    list: () => ({
      [Symbol.asyncIterator]() {
        throw new Error("not implemented");
      },
    }),
    read: refuse,
    write: refuse,
    delete: refuse,
    exists: refuse,
  };
}
