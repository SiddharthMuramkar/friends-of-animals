import { expect, it } from "vitest";
import { cloudflareCdnPurger, noStoreCdnPurger } from "./cdn-purger";
import { FakeCdnPurger } from "@/test/fakes/cdn-purger";

it("batches only same-origin public HTTPS routes; the provider confirms each batch", async () => {
  const requests: { url: string; files: string[] }[] = [];
  const send: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer synthetic-token"
    );
    if (typeof init?.body !== "string")
      throw Error("Expected JSON request body");
    const { files } = JSON.parse(init.body) as { files: string[] };
    requests.push({ url, files });
    return Response.json({ success: true });
  };
  const adapter = cloudflareCdnPurger(
    {
      origin: "https://example.test",
      zoneId: "a".repeat(32),
      token: "synthetic-token",
    },
    send
  );
  const paths = Array.from(
    { length: 31 },
    (_, index) => `/media/gallery/example-${index}`
  );
  await adapter.purge(paths);
  expect(requests.map((r) => r.files.length)).toEqual([30, 1]);
  expect(requests.flatMap((r) => r.files)).toEqual(
    paths.map((p) => `https://example.test${p}`)
  );
  expect(
    requests.every(
      (r) =>
        r.url ===
        `https://api.cloudflare.com/client/v4/zones/${"a".repeat(32)}/purge_cache`
    )
  ).toBe(true);
  await expect(adapter.purge(["//other.example/path"])).rejects.toThrow(
    "Invalid public route"
  );
  expect(() =>
    cloudflareCdnPurger(
      {
        origin: "http://example.test",
        zoneId: "a".repeat(32),
        token: "synthetic-token",
      },
      send
    )
  ).toThrow();
});
it("never mistakes a provider failure for a confirmed purge; fake failures can recover", async () => {
  const adapter = cloudflareCdnPurger(
    {
      origin: "https://example.test",
      zoneId: "b".repeat(32),
      token: "synthetic-token",
    },
    async () => new Response(null, { status: 503 })
  );
  await expect(adapter.purge(["/gallery"])).rejects.toThrow(
    "CDN purge not confirmed"
  );
  const fake = new FakeCdnPurger();
  fake.failNext();
  await expect(fake.purge(["/gallery"])).rejects.toThrow();
  expect(fake.purges).toEqual([]);
  await fake.purge(["/gallery"]);
  expect(fake.purges).toEqual([["/gallery"]]);
  await expect(noStoreCdnPurger.purge(["/gallery"])).resolves.toBeUndefined();
});
