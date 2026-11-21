// The R2 adapter without a network: presigning is computed locally, so its
// URLs are checked as they are built; the other calls go to a recording
// HTTP handler that answers as R2 would. The full contract against a real
// bucket is `pnpm test:live` (./storage-r2.live.test.ts).

import { describe, expect, it } from "vitest";

import { FakeClock } from "@/test/fakes/clock";

import { ObjectMissingError, UnsafePrefixError } from "./storage";
import { r2Storage } from "./storage-r2";

const CONFIG = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
};
const ORIGIN = `https://${CONFIG.accountId}.r2.cloudflarestorage.com`;
const BUCKET = "foa-files-nonprod";

type Answer = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

/** An R2 adapter whose HTTP requests are recorded and answered by `answer`. */
function adapter(answer: (method: string, path: string) => Answer) {
  const clock = new FakeClock("2027-01-15T04:30:00.000Z");
  const requests: { method: string; path: string; query: unknown }[] = [];
  const storage = r2Storage(CONFIG, clock, {
    handle: async (request: {
      method: string;
      path: string;
      query?: unknown;
    }) => {
      requests.push({
        method: request.method,
        path: request.path,
        query: request.query,
      });
      const {
        statusCode,
        headers = {},
        body = "",
      } = answer(request.method, request.path);
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
  return { clock, storage, requests };
}

const noNetwork = () => {
  throw new Error("no request expected");
};

describe("r2Storage presigning", () => {
  it("signs the type and length into a path-style PUT URL", async () => {
    const { storage, requests } = adapter(noNetwork);

    const { url, headers } = await storage.presignPut({
      bucket: BUCKET,
      key: "pr-12/test_upload/01938a00-1234-7abc-8def-0123456789ab",
      contentType: "image/png",
      contentLength: 1234,
      expiresInSeconds: 600,
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.pathname).toBe(
      `/${BUCKET}/pr-12/test_upload/01938a00-1234-7abc-8def-0123456789ab`
    );
    const query = Object.fromEntries(parsed.searchParams);
    expect(query).toMatchObject({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${CONFIG.accessKeyId}/20270115/auto/s3/aws4_request`,
      "X-Amz-Date": "20270115T043000Z",
      "X-Amz-Expires": "600",
      "X-Amz-SignedHeaders": "content-length;content-type;host",
    });
    // A checksum the browser can't compute would fail every upload.
    expect(Object.keys(query).filter((name) => /checksum/i.test(name))).toEqual(
      []
    );
    expect(headers).toEqual({ "Content-Type": "image/png" });
    expect(requests).toEqual([]);
  });

  it("presigns a GET that overrides the type and disposition", async () => {
    const { storage, requests } = adapter(noNetwork);

    const { url } = await storage.presignGet({
      bucket: BUCKET,
      key: "local/test_upload/01938a00-1234-7abc-8def-0123456789ab",
      expiresInSeconds: 300,
      contentType: "application/pdf",
      disposition: "attachment",
      filename: "test_upload-01938a00.pdf",
    });

    const query = Object.fromEntries(new URL(url).searchParams);
    expect(query).toMatchObject({
      "X-Amz-Expires": "300",
      "X-Amz-SignedHeaders": "host",
      "response-content-type": "application/pdf",
      "response-content-disposition":
        'attachment; filename="test_upload-01938a00.pdf"',
    });
    expect(requests).toEqual([]);
  });

  it("refuses a download name that would need quoting", async () => {
    const { storage } = adapter(noNetwork);

    await expect(
      storage.presignGet({
        bucket: BUCKET,
        key: "local/a",
        expiresInSeconds: 300,
        contentType: "image/png",
        disposition: "inline",
        filename: 'a"; filename="evil.html',
      })
    ).rejects.toThrow(/download name/);
  });
});

describe("r2Storage requests", () => {
  it("reads a HEAD as the object's size and type, and a 404 as none", async () => {
    const { storage } = adapter((_method, path) =>
      path.endsWith("/there")
        ? {
            statusCode: 200,
            headers: { "content-length": "1234", "content-type": "image/png" },
          }
        : { statusCode: 404 }
    );

    expect(await storage.head({ bucket: BUCKET, key: "local/there" })).toEqual({
      sizeBytes: 1234,
      contentType: "image/png",
    });
    expect(
      await storage.head({ bucket: BUCKET, key: "local/missing" })
    ).toBeNull();
  });

  it("streams an object, and turns NoSuchKey into ObjectMissingError", async () => {
    const { storage } = adapter((_method, path) =>
      path.endsWith("/there")
        ? { statusCode: 200, body: "bytes" }
        : {
            statusCode: 404,
            headers: { "content-type": "application/xml" },
            body: "<Error><Code>NoSuchKey</Code></Error>",
          }
    );

    const stream = await storage.read({ bucket: BUCKET, key: "local/there" });
    expect(await new Response(stream).text()).toBe("bytes");
    await expect(
      storage.read({ bucket: BUCKET, key: "local/missing" })
    ).rejects.toThrow(ObjectMissingError);
  });

  it("refuses an unsafe prefix before sending anything", async () => {
    const { storage, requests } = adapter(noNetwork);

    for (const prefix of ["", "pr-1", "/pr-1/", "../"]) {
      await expect(
        storage.deletePrefix({ bucket: BUCKET, prefix })
      ).rejects.toThrow(UnsafePrefixError);
    }
    expect(requests).toEqual([]);
  });
});
