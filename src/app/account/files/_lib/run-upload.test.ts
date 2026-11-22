// The upload island's flow (#63), over steps that stand in for the Server
// Actions, the browser's PUT and the timer.

import { describe, expect, it } from "vitest";

import type { FileStatus } from "@/server/modules/files";

import {
  runUpload,
  wait,
  type UploadSteps,
  type UploadView,
} from "./run-upload";

const FILE_ID = "01938a00-0000-7000-8000-000000000201";
const UPLOAD_URL = "https://storage.example.test/foa-files/local/incoming/x";
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
  type: "image/png",
});

type Put = { url: string; headers: Record<string, string> };

/**
 * Steps where the upload goes through and the scan reports `scan` in turn
 * (then `clean`); a test overrides the ones it needs. Waiting moves a
 * clock instead of sleeping.
 */
function stepsWith(
  overrides: Partial<UploadSteps> = {},
  scan: FileStatus[] = ["scanning", "clean"]
): UploadSteps & { puts: Put[] } {
  let clock = 0;
  const statuses = [...scan];
  const puts: Put[] = [];
  return {
    puts,
    requestUpload: async () => ({
      ok: true,
      fileId: FILE_ID,
      uploadUrl: UPLOAD_URL,
      headers: { "Content-Type": "image/png", "Content-Length": "4" },
    }),
    put: async (url, _body, headers) => {
      puts.push({ url, headers });
      return true;
    },
    completeUpload: async () => ({ ok: true, status: "uploaded" }),
    fileStatus: async () => ({ ok: true, status: statuses.shift() ?? "clean" }),
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    ...overrides,
  };
}

async function run(steps: UploadSteps, signal = new AbortController().signal) {
  const shown: UploadView[] = [];
  await runUpload(PNG, signal, (view) => shown.push(view), steps);
  return shown;
}

const failing = () => Promise.reject(new Error("the network dropped"));

describe("runUpload", () => {
  it("uploads, follows the scan, then offers the file", async () => {
    const steps = stepsWith();

    expect(await run(steps)).toEqual([
      { step: "uploading" },
      { step: "checking" },
      { step: "checking" },
      { step: "ready", fileId: FILE_ID },
    ]);
    // Exactly the signed headers, minus the ones a browser sets itself.
    expect(steps.puts).toEqual([
      { url: UPLOAD_URL, headers: { "Content-Type": "image/png" } },
    ]);
  });

  it.each(["requestUpload", "completeUpload", "fileStatus"] as const)(
    "shows a %s step that rejects as errors.unknown, not the error boundary",
    async (step) => {
      const shown = await run(stepsWith({ [step]: failing }));

      expect(shown.at(-1)).toEqual({ step: "failed", message: "unknown" });
    }
  );

  it("says the upload failed when storage refuses the PUT or it never arrives", async () => {
    expect((await run(stepsWith({ put: async () => false }))).at(-1)).toEqual({
      step: "failed",
      message: "uploadFailed",
    });
    expect((await run(stepsWith({ put: failing }))).at(-1)).toEqual({
      step: "failed",
      message: "uploadFailed",
    });
  });

  it("words a step the server refused", async () => {
    const shown = await run(
      stepsWith({
        requestUpload: async () => ({
          ok: false,
          error: "storage_unavailable",
        }),
      })
    );

    expect(shown).toEqual([
      { step: "uploading" },
      { step: "failed", message: "switchedOff" },
    ]);
  });

  it("says a file that failed its checks can't be opened", async () => {
    const shown = await run(stepsWith({}, ["quarantined"]));

    expect(shown.at(-1)).toEqual({ step: "failed", message: "blocked" });
  });

  it("stops asking once the minute is up", async () => {
    const shown = await run(stepsWith({}, Array(40).fill("scanning")));

    expect(shown.at(-1)).toEqual({ step: "slow" });
    // Asked every 2 s: once on completing, then 30 times.
    expect(shown.filter((view) => view.step === "checking")).toHaveLength(31);
  });

  it("stops quietly once aborted, even if a step then fails", async () => {
    const controller = new AbortController();
    const steps = stepsWith({
      fileStatus: () => {
        controller.abort();
        return failing();
      },
    });

    expect(await run(steps, controller.signal)).toEqual([
      { step: "uploading" },
      { step: "checking" },
    ]);
  });

  it("stops quietly when aborted while it waits", async () => {
    const controller = new AbortController();
    let asked = 0;
    const steps = stepsWith({
      wait: async () => controller.abort(),
      fileStatus: async () => {
        asked += 1;
        return { ok: true, status: "clean" };
      },
    });

    expect(await run(steps, controller.signal)).toEqual([
      { step: "uploading" },
      { step: "checking" },
    ]);
    expect(asked).toBe(0);
  });
});

describe("wait", () => {
  /** A signal that counts the abort listeners attached to it. */
  function countingSignal(controller = new AbortController()) {
    let listeners = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((...args: Parameters<typeof add>) => {
      listeners += 1;
      add(...args);
    }) as typeof add;
    signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
      listeners -= 1;
      remove(...args);
    }) as typeof remove;
    return { signal, controller, listeners: () => listeners };
  }

  it("leaves no abort listener behind once its time is up", async () => {
    const { signal, listeners } = countingSignal();

    for (let poll = 0; poll < 3; poll += 1) await wait(1, signal);

    expect(listeners()).toBe(0);
  });

  it("resolves at once for a signal that has already aborted", async () => {
    const { signal, controller, listeners } = countingSignal();
    controller.abort();

    const outcome = await Promise.race([
      wait(60_000, signal).then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
    ]);

    expect(outcome).toBe("resolved");
    expect(listeners()).toBe(0);
  });
});
