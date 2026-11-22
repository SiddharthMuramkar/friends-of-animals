import { afterEach, describe, expect, it, vi } from "vitest";

import { pgTestUrl } from "./pg";

// `pnpm test:pg` seeds a super admin and deletes sessions, so its database
// must be a throwaway one on this machine. A loopback host isn't enough:
// PgBouncer on the database server listens on loopback too.
describe("pgTestUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function withUrl(url: string) {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIRECT_URL", url);
  }

  it("accepts the Compose login on loopback", () => {
    withUrl("postgres://foa:foa@127.0.0.1:5432/foa");
    expect(pgTestUrl()).toBe("postgres://foa:foa@127.0.0.1:5432/foa");
  });

  it("refuses the deployed role over loopback (PgBouncer, a tunnel)", () => {
    withUrl("postgres://foa_app:secret@localhost:6432/foa");
    expect(() => pgTestUrl()).toThrow(/deployed role/);
  });

  it('refuses a URL whose host the client reads past "#@"', () => {
    withUrl("postgres://foa:foa@localhost#@db.example.com:5432/foa");
    expect(() => pgTestUrl()).toThrow(/another host/);
  });

  it("refuses a host named in ?host=", () => {
    withUrl("postgres://foa:foa@localhost:5432/foa?host=db.example.com");
    expect(() => pgTestUrl()).toThrow(/\?host=/);
  });

  it("refuses a remote host", () => {
    withUrl("postgres://foa:foa@db.example.com:5432/foa");
    expect(() => pgTestUrl()).toThrow(/db\.example\.com/);
  });

  it("asks for a URL when none is set", () => {
    withUrl("");
    expect(() => pgTestUrl()).toThrow(/needs DIRECT_URL/);
  });
});
