// The entry form's upload flow (#85) over the real use cases on PGlite: the
// steps call `as(actor)` and PUT to the storage fake, and a test drops a
// step's answer the way a lost connection does.

import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { confirmedAdult, PHOTO } from "@/server/modules/entries/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  runEntryUpload,
  type EntryUploadRequest,
  type EntryUploadSteps,
  type UploadMemory,
} from "./upload-flow";

type Calls = { start: number; put: number; complete: number };

/** The browser's steps for `actor`, counting each call. */
function stepsFor(
  h: Harness,
  actor: Actor,
  overrides: Partial<EntryUploadSteps> = {}
): EntryUploadSteps & { calls: Calls } {
  const calls: Calls = { start: 0, put: 0, complete: 0 };
  const steps: EntryUploadSteps = {
    start: (input) => h.as(actor).startEntryUpload(input),
    complete: (input) => h.as(actor).completeEntryUpload(input),
    put: async (url, body, headers) => {
      const stored = await h.storage.put(
        url,
        new Uint8Array(await body.arrayBuffer()),
        headers
      );
      return stored.ok;
    },
    ...overrides,
  };
  return {
    calls,
    start: (input) => {
      calls.start += 1;
      return steps.start(input);
    },
    complete: (input) => {
      calls.complete += 1;
      return steps.complete(input);
    },
    put: (url, body, headers) => {
      calls.put += 1;
      return steps.put(url, body, headers);
    },
  };
}

function photo(name: string): File {
  return new File([new Uint8Array(PHOTO)], name, { type: "image/jpeg" });
}

function request(registrationId: string, file: File): EntryUploadRequest {
  return {
    registrationId,
    discipline: "photography",
    file,
    title: "The dog at the tea stall",
    description: "Our street dog sleeping under the bench.",
    statement: "",
  };
}

describe("the entry form's upload", () => {
  it("submits an image in one go, and a fresh form opens its entry", async () => {
    const h = await createHarness();
    const adult = await confirmedAdult(h);
    const steps = stepsFor(h, adult.actor);

    const outcome = await runEntryUpload(
      { attempt: null },
      request(adult.registrationId, photo("dog.jpg")),
      steps
    );

    expect(outcome).toEqual({
      ok: true,
      entryCode: expect.stringMatching(/-E-[0-9A-HJKMNP-TV-Z]{6}$/),
    });
    expect(steps.calls).toEqual({ start: 1, put: 1, complete: 1 });
  });

  it("recovers when the answer to a new image's grant request is lost", async () => {
    const h = await createHarness();
    const adult = await confirmedAdult(h);
    const memory: UploadMemory = { attempt: null };

    // The first image never reaches storage.
    const first = await runEntryUpload(
      memory,
      request(adult.registrationId, photo("first.jpg")),
      stepsFor(h, adult.actor, { put: async () => false })
    );
    expect(first).toEqual({ ok: false, error: "upload_missing" });

    // A second image: the server grants it, retiring the first grant, but
    // the answer never arrives.
    const second = photo("second.jpg");
    const lost = await runEntryUpload(
      memory,
      request(adult.registrationId, second),
      stepsFor(h, adult.actor, {
        start: async (input) => {
          await h.as(adult.actor).startEntryUpload(input);
          throw new TypeError("Failed to fetch");
        },
      })
    );
    expect(lost).toEqual({ ok: false, error: "unknown" });

    // Trying again restarts the grant the form never heard about, rather
    // than naming the retired one and being refused as over the limit.
    const steps = stepsFor(h, adult.actor);
    const again = await runEntryUpload(
      memory,
      request(adult.registrationId, second),
      steps
    );
    expect(again).toMatchObject({ ok: true });
    expect(steps.calls).toEqual({ start: 1, put: 1, complete: 1 });
  });

  it("only completes again after a lost completion answer", async () => {
    const h = await createHarness();
    const adult = await confirmedAdult(h);
    const memory: UploadMemory = { attempt: null };
    const file = photo("dog.jpg");
    let completed: unknown;

    const lost = await runEntryUpload(
      memory,
      request(adult.registrationId, file),
      stepsFor(h, adult.actor, {
        complete: async (input) => {
          completed = await h.as(adult.actor).completeEntryUpload(input);
          throw new TypeError("Failed to fetch");
        },
      })
    );
    expect(lost).toEqual({ ok: false, error: "unknown" });
    expect(completed).toMatchObject({ ok: true });

    const steps = stepsFor(h, adult.actor);
    const again = await runEntryUpload(
      memory,
      request(adult.registrationId, file),
      steps
    );

    expect(again).toEqual({
      ok: true,
      entryCode: (completed as { entryCode: string }).entryCode,
    });
    expect(steps.calls).toEqual({ start: 0, put: 0, complete: 1 });
  });

  it("puts the same image again when storage never got it", async () => {
    const h = await createHarness();
    const adult = await confirmedAdult(h);
    const memory: UploadMemory = { attempt: null };
    const file = photo("dog.jpg");

    const dropped = await runEntryUpload(
      memory,
      request(adult.registrationId, file),
      stepsFor(h, adult.actor, {
        put: async () => {
          throw new TypeError("Failed to fetch");
        },
      })
    );
    expect(dropped).toEqual({ ok: false, error: "upload_missing" });

    const steps = stepsFor(h, adult.actor);
    const again = await runEntryUpload(
      memory,
      request(adult.registrationId, file),
      steps
    );
    expect(again).toMatchObject({ ok: true });
    expect(steps.calls).toEqual({ start: 0, put: 1, complete: 1 });
  });

  it("shows a refused grant without remembering it", async () => {
    const h = await createHarness();
    const adult = await confirmedAdult(h);
    const memory: UploadMemory = { attempt: null };

    const refused = await runEntryUpload(
      memory,
      request(
        adult.registrationId,
        new File(["notes"], "notes.txt", { type: "text/plain" })
      ),
      stepsFor(h, adult.actor)
    );

    expect(refused).toEqual({ ok: false, error: "wrong_type" });
    expect(memory.attempt).toBeNull();
  });
});
