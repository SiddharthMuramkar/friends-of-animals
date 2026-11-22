// The R2 adapter for ObjectStorage, through R2's S3-compatible API with the
// AWS SDK. Path-style URLs on https://<account>.r2.cloudflarestorage.com;
// the bucket's CORS rules (owner residue HR-06/HR-13) must allow PUT from
// the site's origins for browser uploads. Another S3-compatible store
// (S3 Mumbai) needs only another endpoint, region and credentials.
//
// R2 has no presigned POST policy, so a presigned PUT signs Content-Type
// and Content-Length into the URL: a PUT with any other type or length
// fails its signature. Checksums are only sent where an operation requires
// one, because a browser can't compute the SDK's default CRC for a PUT.

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { r2Origin } from "../../lib/r2-origin";
import type { Clock } from "./clock";
import {
  contentDispositionFor,
  FILE_CACHE_CONTROL,
  isPurgeablePrefix,
  ObjectMissingError,
  UnsafePrefixError,
  type ObjectRef,
  type ObjectStorage,
} from "./storage";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** The headers a presigned PUT signs, so the browser can't change them. */
const SIGNED_UPLOAD_HEADERS = new Set(["content-type", "content-length"]);

/** S3 deletes at most 1,000 keys per request. */
const DELETE_BATCH = 1000;

/**
 * R2 storage for `config`. Presigned URLs are dated by `clock`. Tests pass
 * `requestHandler` to answer the SDK's HTTP requests without a network.
 */
export function r2Storage(
  config: R2Config,
  clock: Clock,
  requestHandler?: S3ClientConfig["requestHandler"]
): ObjectStorage {
  const endpoint = r2Origin(config.accountId);
  if (!endpoint) throw new Error("R2_ACCOUNT_ID is not an R2 account id");
  const client = new S3Client({
    region: "auto",
    endpoint,
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
    async presignPut({
      bucket,
      key,
      contentType,
      contentLength,
      expiresInSeconds,
    }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
        {
          expiresIn: expiresInSeconds,
          signableHeaders: SIGNED_UPLOAD_HEADERS,
          signingDate: clock.now(),
        }
      );
      return { url, headers: { "Content-Type": contentType } };
    },

    async presignGet({
      bucket,
      key,
      expiresInSeconds,
      contentType,
      disposition,
      filename,
    }) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: contentDispositionFor(
            disposition,
            filename
          ),
          // Overrides any Cache-Control the object carries (copies keep it).
          ResponseCacheControl: FILE_CACHE_CONTROL,
        }),
        { expiresIn: expiresInSeconds, signingDate: clock.now() }
      );
      return { url };
    },

    async head({ bucket, key }) {
      try {
        const object = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key })
        );
        return {
          sizeBytes: object.ContentLength ?? 0,
          contentType: object.ContentType ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async read(ref) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key })
        );
        if (!object.Body) throw new ObjectMissingError(ref);
        return object.Body.transformToWebStream();
      } catch (error) {
        throw isNotFound(error) ? new ObjectMissingError(ref) : error;
      }
    },

    async write({ bucket, key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        })
      );
    },

    async move({ bucket, from, to }) {
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: to,
            CopySource: `${bucket}/${encodeKey(from)}`,
          })
        );
      } catch (error) {
        throw isNotFound(error)
          ? new ObjectMissingError({ bucket, key: from })
          : error;
      }
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }));
    },

    async delete({ bucket, key }: ObjectRef) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async deletePrefix({ bucket, prefix }) {
      if (!isPurgeablePrefix(prefix)) throw new UnsafePrefixError(prefix);
      let deleted = 0;
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: DELETE_BATCH,
            ContinuationToken: token,
          })
        );
        const keys = (page.Contents ?? []).flatMap((object) =>
          object.Key ? [{ Key: object.Key }] : []
        );
        if (keys.length > 0) {
          const result = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys, Quiet: true },
            })
          );
          if (result.Errors && result.Errors.length > 0) {
            throw new Error(
              `R2 refused to delete ${result.Errors.length} objects under ${prefix}`
            );
          }
          deleted += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return { deleted };
    },
  };
}

/** A 404, or S3's NoSuchKey/NotFound by name. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NotFound" ||
      error.name === "NoSuchKey" ||
      error.$metadata.httpStatusCode === 404)
  );
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
