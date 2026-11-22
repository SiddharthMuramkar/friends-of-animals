// The S3 copy-bucket adapter without a network: every call goes to a
// recording HTTP handler that answers as R2 or B2 would. The full contract
// against a real bucket is ./copy-bucket-s3.live.test.ts (by hand).

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ContentDigestMismatchError, type ListedObject } from "./copy-bucket";
import { bytesOf, streamOf } from "./copy-bucket.contract";
import { s3CopyBucket, type S3BucketConfig } from "./copy-bucket-s3";

const B2: S3BucketConfig = {
  endpoint: "https://s3.eu-central-003.backblazeb2.com",
  region: "eu-central-003",
  accessKeyId: "test-key-id",
  secretAccessKey: "test-application-key",
  serverSideEncryption: "AES256",
};
const R2: S3BucketConfig = {
  endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
};

type Answer = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

type Recorded = {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: string;
};

async function bodyText(body: unknown): Promise<string> {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** An adapter whose HTTP requests are recorded and answered by `answer`. */
function adapter(
  config: S3BucketConfig,
  answer: (request: Recorded, index: number) => Answer
) {
  const requests: Recorded[] = [];
  const store = s3CopyBucket(config, {
    handle: async (request: {
      method: string;
      path: string;
      query?: Record<string, unknown>;
      headers: Record<string, string>;
      body?: unknown;
    }) => {
      const recorded: Recorded = {
        method: request.method,
        path: request.path,
        query: request.query ?? {},
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])
        ),
        body: await bodyText(request.body),
      };
      requests.push(recorded);
      const {
        statusCode,
        headers = {},
        body = "",
      } = answer(recorded, requests.length - 1);
      return {
        response: {
          statusCode,
          reason: "",
          headers,
          body: new Blob([body]).stream(),
        },
      };
    },
  });
  return { store, requests };
}

const ok = (): Answer => ({ statusCode: 200 });

function md5(text: string, encoding: "hex" | "base64"): string {
  return createHash("md5").update(text).digest(encoding);
}

function listPage(
  contents: { key: string; etag: string; size: number }[],
  next?: string
): Answer {
  const items = contents
    .map(
      ({ key, etag, size }) =>
        `<Contents><Key>${key}</Key><LastModified>2027-01-15T04:30:00.000Z</LastModified>` +
        `<ETag>&quot;${etag}&quot;</ETag><Size>${size}</Size><StorageClass>STANDARD</StorageClass></Contents>`
    )
    .join("");
  const truncated = next
    ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${next}</NextContinuationToken>`
    : "<IsTruncated>false</IsTruncated>";
  return {
    statusCode: 200,
    headers: { "content-type": "application/xml" },
    body:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      `<Name>foa-files-prod</Name><Prefix></Prefix><MaxKeys>1000</MaxKeys>${truncated}${items}` +
      "</ListBucketResult>",
  };
}

function s3Error(statusCode: number, code: string): Answer {
  return {
    statusCode,
    headers: { "content-type": "application/xml" },
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`,
  };
}

const BYTES = "a copy worth keeping";

function writeInput(contentMd5: string | null) {
  const bytes = new TextEncoder().encode(BYTES);
  return {
    bucket: "foa-offsite-b2",
    key: "foa-files-prod/avatar/a",
    body: streamOf(bytes),
    sizeBytes: bytes.length,
    contentType: "image/png",
    contentMd5,
    metadata: { "foa-source-etag": md5(BYTES, "hex") },
  };
}

describe("s3CopyBucket writes", () => {
  it("PUTs path-style with the length, type, metadata, Content-MD5 and B2's encryption", async () => {
    const { store, requests } = adapter(B2, ok);

    await store.write(writeInput(md5(BYTES, "base64")));

    expect(requests).toHaveLength(1);
    const [put] = requests;
    expect(put).toMatchObject({
      method: "PUT",
      path: "/foa-offsite-b2/foa-files-prod/avatar/a",
      body: BYTES,
    });
    expect(put?.headers).toMatchObject({
      host: "s3.eu-central-003.backblazeb2.com",
      "content-length": String(BYTES.length),
      "content-type": "image/png",
      "content-md5": md5(BYTES, "base64"),
      "x-amz-meta-foa-source-etag": md5(BYTES, "hex"),
      "x-amz-server-side-encryption": "AES256",
    });
    // The SDK's default CRC checksums aren't sent: R2 and B2 get the MD5.
    expect(
      Object.keys(put?.headers ?? {}).filter((name) => /checksum/.test(name))
    ).toEqual([]);
  });

  it("sends no Content-MD5 for a multipart object", async () => {
    const { store, requests } = adapter(B2, ok);

    await store.write(writeInput(null));

    expect(requests[0]?.headers).not.toHaveProperty("content-md5");
  });

  it("asks R2 for no server-side encryption header", async () => {
    const { store, requests } = adapter(R2, ok);

    await store.write(writeInput(md5(BYTES, "base64")));

    expect(requests[0]?.headers).not.toHaveProperty(
      "x-amz-server-side-encryption"
    );
  });

  it("turns S3's BadDigest into ContentDigestMismatchError", async () => {
    const { store } = adapter(B2, () => s3Error(400, "BadDigest"));

    await expect(
      store.write(writeInput(md5("other", "base64")))
    ).rejects.toThrow(ContentDigestMismatchError);
  });
});

describe("s3CopyBucket listing", () => {
  it("pages through to the end, with normalised etags", async () => {
    const { store, requests } = adapter(R2, (_, index) =>
      index === 0
        ? listPage([{ key: "avatar/a", etag: "AAAA", size: 1 }], "page-2")
        : listPage([{ key: "avatar/b", etag: "bbbb-2", size: 2 }])
    );

    const listed: ListedObject[] = [];
    for await (const object of store.list({
      bucket: "foa-files-prod",
      prefix: "avatar/",
    })) {
      listed.push(object);
    }

    expect(listed).toEqual([
      {
        key: "avatar/a",
        etag: "aaaa",
        sizeBytes: 1,
        lastModified: new Date("2027-01-15T04:30:00.000Z"),
      },
      {
        key: "avatar/b",
        etag: "bbbb-2",
        sizeBytes: 2,
        lastModified: new Date("2027-01-15T04:30:00.000Z"),
      },
    ]);
    expect(requests.map(({ path, query }) => ({ path, query }))).toEqual([
      {
        path: "/foa-files-prod/",
        query: expect.objectContaining({ "list-type": "2", prefix: "avatar/" }),
      },
      {
        path: "/foa-files-prod/",
        query: expect.objectContaining({
          "list-type": "2",
          prefix: "avatar/",
          "continuation-token": "page-2",
        }),
      },
    ]);
  });

  it("throws when a later page fails", async () => {
    const { store } = adapter(R2, (_, index) =>
      index === 0
        ? listPage([{ key: "avatar/a", etag: "aaaa", size: 1 }], "page-2")
        : s3Error(500, "InternalError")
    );

    const listed: string[] = [];
    await expect(async () => {
      for await (const { key } of store.list({ bucket: "foa-files-prod" })) {
        listed.push(key);
      }
    }).rejects.toThrow();
    expect(listed).toEqual(["avatar/a"]);
  });
});

describe("s3CopyBucket reads", () => {
  it("streams the body with its type, normalised etag and metadata", async () => {
    const { store, requests } = adapter(R2, () => ({
      statusCode: 200,
      headers: {
        "content-length": String(BYTES.length),
        "content-type": "image/png",
        etag: `"${md5(BYTES, "hex").toUpperCase()}"`,
        "x-amz-meta-uploaded-by": "files",
      },
      body: BYTES,
    }));

    const read = await store.read({
      bucket: "foa-files-prod",
      key: "avatar/a",
    });

    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/foa-files-prod/avatar/a",
    });
    expect(read).toEqual({
      body: expect.any(ReadableStream),
      sizeBytes: BYTES.length,
      contentType: "image/png",
      etag: md5(BYTES, "hex"),
      metadata: { "uploaded-by": "files" },
    });
    expect(new TextDecoder().decode(await bytesOf(read!.body))).toBe(BYTES);
  });

  it("reads null for a missing key", async () => {
    const { store } = adapter(R2, () => s3Error(404, "NoSuchKey"));

    expect(
      await store.read({ bucket: "foa-files-prod", key: "avatar/none" })
    ).toBeNull();
  });

  it("says whether an object exists from a HEAD", async () => {
    const { store, requests } = adapter(R2, ({ path }) =>
      path.endsWith("/here")
        ? { statusCode: 200, headers: { "content-length": "1" } }
        : { statusCode: 404 }
    );

    expect(await store.exists({ bucket: "foa-files-prod", key: "here" })).toBe(
      true
    );
    expect(await store.exists({ bucket: "foa-files-prod", key: "gone" })).toBe(
      false
    );
    expect(requests.map(({ method }) => method)).toEqual(["HEAD", "HEAD"]);
  });

  it("deletes with a DELETE", async () => {
    const { store, requests } = adapter(B2, () => ({ statusCode: 204 }));

    await store.delete({ bucket: "foa-offsite-b2", key: "foa-files-prod/a" });

    expect(requests[0]).toMatchObject({
      method: "DELETE",
      path: "/foa-offsite-b2/foa-files-prod/a",
    });
  });
});
