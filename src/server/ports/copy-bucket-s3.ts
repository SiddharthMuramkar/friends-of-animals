// The S3-API adapter for CopyBucket, with the AWS SDK: R2 (the production
// buckets, https://<account>.r2.cloudflarestorage.com, region "auto") and
// Backblaze B2 (the copies, its S3 endpoint and region) both speak it.
// Path-style URLs. The SDK's default CRC checksums are off: each write
// carries the object's Content-MD5 instead, which both stores check.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import { normaliseEtag } from "../modules/offsite-copy/domain/etag";
import {
  ContentDigestMismatchError,
  type CopyBucket,
  type ListedObject,
} from "./copy-bucket";

export type S3BucketConfig = {
  /** e.g. https://<account>.r2.cloudflarestorage.com or B2's S3 endpoint. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** B2: "AES256" asks for SSE-B2 on every write. R2 encrypts anyway. */
  serverSideEncryption?: "AES256";
};

/** R2's S3 endpoint for a Cloudflare account. */
export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** S3's answer to bytes that don't match their Content-MD5. */
const DIGEST_ERRORS = new Set(["BadDigest", "InvalidDigest"]);

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata.httpStatusCode === 404)
  );
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The S3 response has no ${what}`);
  }
  return value;
}

/**
 * A CopyBucket over the S3 API at `config.endpoint`. Tests pass
 * `requestHandler` to answer the SDK's HTTP requests without a network.
 */
export function s3CopyBucket(
  config: S3BucketConfig,
  requestHandler?: S3ClientConfig["requestHandler"]
): CopyBucket {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(requestHandler ? { requestHandler } : {}),
  });

  return {
    async *list({ bucket, prefix }): AsyncIterable<ListedObject> {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ...(prefix === undefined ? {} : { Prefix: prefix }),
            ...(token === undefined ? {} : { ContinuationToken: token }),
          })
        );
        for (const item of page.Contents ?? []) {
          yield {
            key: required(item.Key, "key"),
            etag: normaliseEtag(required(item.ETag, "etag")),
            sizeBytes: required(item.Size, "size"),
            lastModified: required(item.LastModified, "last-modified time"),
          };
        }
        token = page.IsTruncated
          ? required(page.NextContinuationToken, "continuation token")
          : undefined;
      } while (token !== undefined);
    },

    async read({ bucket, key }) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        const body = required(object.Body, "body");
        return {
          body: body.transformToWebStream(),
          sizeBytes: required(object.ContentLength, "length"),
          contentType: object.ContentType ?? null,
          etag: normaliseEtag(required(object.ETag, "etag")),
          metadata: object.Metadata ?? {},
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async write(input) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            Body: Readable.fromWeb(
              input.body as NodeReadableStream<Uint8Array>
            ),
            ContentLength: input.sizeBytes,
            ...(input.contentType === null
              ? {}
              : { ContentType: input.contentType }),
            ...(input.contentMd5 === null
              ? {}
              : { ContentMD5: input.contentMd5 }),
            Metadata: input.metadata,
            ...(config.serverSideEncryption
              ? { ServerSideEncryption: config.serverSideEncryption }
              : {}),
          })
        );
      } catch (error) {
        if (
          error instanceof S3ServiceException &&
          DIGEST_ERRORS.has(error.name)
        ) {
          throw new ContentDigestMismatchError(input);
        }
        throw error;
      }
    },

    async delete({ bucket, key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async exists({ bucket, key }) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
  };
}
