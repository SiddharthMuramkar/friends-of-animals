import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp, type UseCases } from "@/server/app";
import { fileAsset } from "@/server/db/schema";
import { unconfiguredStorage } from "@/server/ports/storage";
import { createHarness } from "@/test/harness";

import {
  completeRequest,
  downloadRequest,
  presignRequest,
  readJson,
  toResponse,
} from "./file-requests";

const PNG = new Uint8Array(1234).fill(7);
const pngUpload = {
  purpose: "test_upload",
  contentType: "image/png",
  sizeBytes: PNG.length,
};

function post(body: string, contentType: string | null = "application/json") {
  return new Request("http://localhost:3000/api/files/presign", {
    method: "POST",
    body,
    headers: contentType ? { "content-type": contentType } : {},
  });
}

async function world() {
  const h = await createHarness();
  const owner = await h.signIn(await h.seed.member());
  return { h, owner };
}

/** A member's PNG, uploaded and completed. */
async function uploaded() {
  const ctx = await world();
  const { h, owner } = ctx;
  const presigned = await presignRequest(
    h.as(owner),
    await readJson(post(JSON.stringify(pngUpload)))
  );
  const { fileId, uploadUrl, headers } = presigned.body as {
    fileId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  await h.storage.put(uploadUrl, PNG, headers);
  await completeRequest(h.as(owner), fileId);
  return { ...ctx, fileId };
}

/**
 * `useCases`, recording what each files use case is called with, so a test
 * can see what got past the request's validation.
 */
function recording(useCases: UseCases) {
  const calls: [string, unknown][] = [];
  const wrapped: UseCases = {
    ...useCases,
    requestUpload: (input) => {
      calls.push(["requestUpload", input]);
      return useCases.requestUpload(input);
    },
    completeUpload: (input) => {
      calls.push(["completeUpload", input]);
      return useCases.completeUpload(input);
    },
    getFileDownloadUrl: (input) => {
      calls.push(["getFileDownloadUrl", input]);
      return useCases.getFileDownloadUrl(input);
    },
  };
  return { useCases: wrapped, calls };
}

describe("validating each request at the edge", () => {
  it("hands the presign use case only the parsed declaration", async () => {
    const { h, owner } = await world();
    const { useCases, calls } = recording(h.as(owner));

    const response = await presignRequest(
      useCases,
      await readJson(
        post(JSON.stringify({ ...pngUpload, ownerUserId: "someone-else" }))
      )
    );

    expect(response.status).toBe(201);
    expect(calls).toEqual([["requestUpload", pngUpload]]);
  });

  it("answers a declaration of the wrong shape 400 without calling the use case", async () => {
    const h = await createHarness();
    for (const actor of [await h.signIn(await h.seed.member()), h.visitor()]) {
      const { useCases, calls } = recording(h.as(actor));

      expect(
        await presignRequest(
          useCases,
          await readJson(
            post(JSON.stringify({ ...pngUpload, sizeBytes: "12" }))
          )
        )
      ).toEqual({
        status: 400,
        body: { error: "invalid_input", fields: ["sizeBytes"] },
      });
      expect(
        await presignRequest(useCases, await readJson(post("[1]")))
      ).toMatchObject({ status: 400, body: { error: "invalid_input" } });
      expect(calls).toEqual([]);
    }
  });

  it("answers a file id that isn't a UUID 400 without calling the use case", async () => {
    const { h, owner } = await world();
    const { useCases, calls } = recording(h.as(owner));

    for (const answer of [
      await completeRequest(useCases, "../etc"),
      await downloadRequest(useCases, "x"),
    ]) {
      expect(answer).toEqual({
        status: 400,
        body: { error: "invalid_input", fields: ["fileId"] },
      });
    }
    expect(calls).toEqual([]);
  });
});

describe("readJson", () => {
  it("reads a JSON body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(
      await readJson(post('{"a":1}', "application/json; charset=utf-8"))
    ).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuses another content type, which a cross-site form could send", async () => {
    expect(await readJson(post('{"a":1}', "text/plain"))).toEqual({
      ok: false,
      response: { status: 415, body: { error: "json_required" } },
    });
    expect(await readJson(post('{"a":1}', null))).toMatchObject({
      ok: false,
      response: { status: 415 },
    });
  });

  it("refuses a body that isn't JSON", async () => {
    expect(await readJson(post("{"))).toEqual({
      ok: false,
      response: { status: 400, body: { error: "invalid_input", fields: [] } },
    });
  });
});

describe("presignRequest", () => {
  it("answers 201 with the upload URL and headers", async () => {
    const { h, owner } = await world();

    const response = await presignRequest(
      h.as(owner),
      await readJson(post(JSON.stringify(pngUpload)))
    );

    expect(response).toEqual({
      status: 201,
      body: {
        fileId: expect.any(String),
        uploadUrl: expect.stringMatching(/^https:\/\/storage\.fake\.test\//),
        headers: { "Content-Type": "image/png" },
        expiresAt: new Date(h.clock.now().getTime() + 600_000).toISOString(),
      },
    });
  });

  it.each([
    [{ sizeBytes: 11 * 1024 * 1024 }, 413, "too_large"],
    [{ contentType: "text/html" }, 415, "type_not_allowed"],
    [{ sizeBytes: 0 }, 400, "empty"],
    [{ purpose: "avatar" }, 400, "invalid_input"],
  ])(
    "answers a refused declaration %j with %i",
    async (change, status, error) => {
      const { h, owner } = await world();

      const response = await presignRequest(
        h.as(owner),
        await readJson(post(JSON.stringify({ ...pngUpload, ...change })))
      );

      expect(response).toMatchObject({ status, body: { error } });
    }
  );

  it("answers 403 to a visitor and passes on a body it couldn't read", async () => {
    const h = await createHarness();

    expect(
      await presignRequest(
        h.as(h.visitor()),
        await readJson(post(JSON.stringify(pngUpload)))
      )
    ).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(
      await presignRequest(h.as(h.visitor()), await readJson(post("{")))
    ).toMatchObject({ status: 400 });
  });

  it("answers 503 while storage isn't configured", async () => {
    const { h, owner } = await world();
    const app = createApp({ ...h.deps, storage: unconfiguredStorage });

    expect(
      await presignRequest(
        app.as(owner),
        await readJson(post(JSON.stringify(pngUpload)))
      )
    ).toEqual({ status: 503, body: { error: "storage_unavailable" } });
  });
});

describe("completeRequest", () => {
  it("answers 200 with the file's status, and 409 before the upload", async () => {
    const { h, owner } = await world();
    const presigned = await presignRequest(
      h.as(owner),
      await readJson(post(JSON.stringify(pngUpload)))
    );
    const { fileId, uploadUrl, headers } = presigned.body as {
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };

    expect(await completeRequest(h.as(owner), fileId)).toEqual({
      status: 409,
      body: { error: "upload_missing" },
    });
    await h.storage.put(uploadUrl, PNG, headers);
    expect(await completeRequest(h.as(owner), fileId)).toEqual({
      status: 200,
      body: { fileId, status: "uploaded" },
    });
  });

  it("answers 403 to anyone but the uploader", async () => {
    const { h, fileId } = await uploaded();
    const other = await h.signIn(await h.seed.member());

    expect(await completeRequest(h.as(other), fileId)).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
  });
});

describe("downloadRequest", () => {
  it("redirects to a signed URL that serves the file", async () => {
    const { h, owner, fileId } = await uploaded();

    const response = await downloadRequest(h.as(owner), fileId);

    expect(response).toEqual({ status: 302, location: expect.any(String) });
    expect(await h.storage.get(response.location!)).toMatchObject({
      ok: true,
      bytes: PNG,
    });
  });

  it("answers 409 before the scan, 410 once quarantined, 404 for no file", async () => {
    const { h, fileId } = await uploaded();
    const staff = await h.signIn(await h.seed.superAdmin());

    expect(await downloadRequest(h.as(staff), fileId)).toEqual({
      status: 409,
      body: { error: "file_not_ready" },
    });
    await h.db
      .update(fileAsset)
      .set({ status: "quarantined" })
      .where(eq(fileAsset.id, fileId));
    expect(await downloadRequest(h.as(staff), fileId)).toEqual({
      status: 410,
      body: { error: "file_unavailable" },
    });
    expect(
      await downloadRequest(h.as(staff), "01938a00-0000-7000-8000-000000000000")
    ).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await downloadRequest(h.as(staff), "x")).toMatchObject({
      status: 400,
      body: { error: "invalid_input" },
    });
  });

  it("answers 403 to a visitor", async () => {
    const { h, fileId } = await uploaded();

    expect(await downloadRequest(h.as(h.visitor()), fileId)).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
  });

  it("answers a member 403 alike for another's file and for no file", async () => {
    const { h, fileId } = await uploaded();
    const other = await h.signIn(await h.seed.member());

    for (const id of [fileId, "01938a00-0000-7000-8000-000000000000"]) {
      expect(await downloadRequest(h.as(other), id)).toEqual({
        status: 403,
        body: { error: "forbidden" },
      });
    }
  });
});

describe("toResponse", () => {
  it("never lets a response be cached or indexed", async () => {
    for (const answer of [
      { status: 302, location: "https://storage.fake.test/b/k?x=1" },
      { status: 403, body: { error: "forbidden" } },
    ]) {
      const response = toResponse(answer);
      expect(response.status).toBe(answer.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("keeps the signed URL out of the Referer of the page it opens", () => {
    const response = toResponse({
      status: 302,
      location: "https://storage.fake.test/b/k?x=1",
    });

    expect(response.headers.get("location")).toBe(
      "https://storage.fake.test/b/k?x=1"
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
