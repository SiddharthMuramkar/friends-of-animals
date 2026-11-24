import { expect, it, vi } from "vitest";

import type { Actor } from "@/server/actor";
import {
  completeEntryUploadInput,
  startEntryUploadInput,
} from "@/server/modules/entries";
import {
  confirmedChild,
  putEntryImage,
} from "@/server/modules/entries/testing";
import { createHarness } from "@/test/harness";

import { forParticipant } from "./upload-action";

it("rejects malformed upload arguments at the action boundary", async () => {
  const h = await createHarness();
  await confirmedChild(h);
  const as = vi.fn((actor: Actor) => h.as(actor));

  await expect(
    forParticipant(
      () => h.currentActor(),
      as,
      startEntryUploadInput,
      {
        registrationId: "wrong",
        file: { name: "image.jpg", type: "image/jpeg", size: -1 },
      },
      (app, data) => app.startEntryUpload(data)
    )
  ).resolves.toEqual({
    ok: false,
    error: "invalid_input",
    fields: ["registrationId", "file"],
  });
  expect(as).not.toHaveBeenCalled();
});

it("returns a generic upload error and logs only the class and SQLSTATE when an entry write fails", async () => {
  const h = await createHarness();
  const guardian = await confirmedChild(h);
  const input = await putEntryImage(h, guardian, {
    text: {
      title: "A child's fixture title",
      description: "A child's fixture description",
      statement: "A child's fixture statement",
    },
  });
  await h.db.$client.exec(
    'ALTER TABLE "entry" ADD CONSTRAINT fixture_refuses_write CHECK (false)'
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const action = forParticipant(
      () => h.currentActor(),
      (actor) => h.as(actor),
      completeEntryUploadInput,
      input,
      (app, data) => app.completeEntryUpload(data)
    );
    await expect(action).resolves.toEqual({ ok: false, error: "unknown" });
    expect(log.mock.calls).toEqual([
      ["Entry upload failed: DrizzleQueryError (Postgres 23514)"],
    ]);
  } finally {
    log.mockRestore();
  }
});
