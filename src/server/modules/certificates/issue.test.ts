import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { uuidv7 } from "../../ids";
const worker = { kind: "system", process: "worker" } as const;
it("refuses untrusted publication and never issues from a missing release", async () => {
  const h = await createHarness();
  const input = {
    competitionId: uuidv7(h.clock.now()),
    releaseId: uuidv7(h.clock.now()),
    publishedAt: h.clock.now().toISOString(),
  };
  await expect(
    h.as(h.visitor()).issueCertificates(input)
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await h.as(worker).issueCertificates(input)).toEqual({ issued: 0 });
});
