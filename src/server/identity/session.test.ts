import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

describe("resolveActor", () => {
  it("resolves a browser with a live session cookie as its user", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const signedIn = await h.signIn(member);

    expect(signedIn).toMatchObject({ kind: "user", userId: member.id });
    expect(await h.currentActor()).toMatchObject({
      kind: "user",
      userId: member.id,
      sessionId: signedIn.kind === "user" ? signedIn.sessionId : "",
    });
  });

  // A failed lookup's database error lists the query's parameters, the
  // session token among them, and Next logs whatever a render throws.
  it("fails without the session token in the error", async () => {
    const h = await createHarness();
    await h.signIn(await h.seed.member());
    const cookie = decodeURIComponent(h.cookies.header().split("=")[1] ?? "");
    const token = cookie.split(".")[0] ?? "";
    expect(token).not.toBe("");
    await h.db.$client.exec('ALTER TABLE "session" RENAME TO "session_gone"');

    const error: unknown = await h.currentActor().then(
      () => null,
      (failure: unknown) => failure
    );

    expect(error).toBeInstanceOf(Error);
    expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(
      token
    );
    // Still says what failed: the class and the Postgres code.
    expect(String(error)).toMatch(/42P01/);
  });
});
