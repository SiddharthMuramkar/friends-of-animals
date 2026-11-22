// The upload island's flow (../_components/upload-form.tsx), apart from
// React and the network so it is tested on its own: presign, PUT the file
// straight to storage with exactly the signed headers, complete, then ask
// about the scan every 2 s for a minute. Each step is reported through
// `show`; once `signal` aborts the flow stops quietly.

import {
  messageKeyFor,
  nextPollDelay,
  phaseForStatus,
  putHeaders,
  type MessageKey,
} from "./upload";
import type { FileStatusView, RequestUploadView } from "./upload-steps";

/** What the island shows. */
export type UploadView =
  | { step: "idle" }
  | { step: "uploading" }
  | { step: "checking" }
  | { step: "ready"; fileId: string }
  | { step: "slow" }
  | { step: "failed"; message: MessageKey };

/** How the flow reaches the server, storage and time; the island passes the real ones. */
export type UploadSteps = {
  /** The Server Actions (../_lib/actions.ts). */
  requestUpload(input: {
    contentType: string;
    sizeBytes: number;
  }): Promise<RequestUploadView>;
  completeUpload(fileId: string): Promise<FileStatusView>;
  fileStatus(fileId: string): Promise<FileStatusView>;
  /** The browser's PUT of `body` to a signed URL: true if storage took it. */
  put(
    url: string,
    body: Blob,
    headers: Record<string, string>,
    signal: AbortSignal
  ): Promise<boolean>;
  /** Resolves after `ms`, or at once if `signal` aborts. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
  /** Now, in milliseconds. */
  now(): number;
};

/** Resolves after `ms`, or at once if `signal` aborts. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    // Whichever comes first, the timer or the abort, removes the other.
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * Uploads `file`, then follows its scan until it is ready or the minute is
 * up. It never rejects: a step that does (the network dropped, or the
 * server failed) is shown as errors.unknown, so the island keeps its form
 * rather than falling to the error boundary.
 */
export async function runUpload(
  file: Blob,
  signal: AbortSignal,
  show: (view: UploadView) => void,
  steps: UploadSteps
): Promise<void> {
  try {
    await upload(file, signal, show, steps);
  } catch {
    if (!signal.aborted) show({ step: "failed", message: "unknown" });
  }
}

async function upload(
  file: Blob,
  signal: AbortSignal,
  show: (view: UploadView) => void,
  steps: UploadSteps
): Promise<void> {
  show({ step: "uploading" });
  const requested = await steps.requestUpload({
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!requested.ok) {
    return show({ step: "failed", message: messageKeyFor(requested.error) });
  }
  try {
    const stored = await steps.put(
      requested.uploadUrl,
      file,
      putHeaders(requested.headers),
      signal
    );
    if (!stored) return show({ step: "failed", message: "uploadFailed" });
  } catch {
    if (signal.aborted) return;
    return show({ step: "failed", message: "uploadFailed" });
  }

  const { fileId } = requested;
  let result = await steps.completeUpload(fileId);
  const started = steps.now();
  for (;;) {
    if (signal.aborted) return;
    if (!result.ok) {
      return show({ step: "failed", message: messageKeyFor(result.error) });
    }
    const phase = phaseForStatus(result.status);
    if (phase === "ready") return show({ step: "ready", fileId });
    if (phase === "unavailable") {
      return show({ step: "failed", message: "blocked" });
    }
    show({ step: "checking" });
    const delay = nextPollDelay(steps.now() - started);
    if (delay === null) return show({ step: "slow" });
    await steps.wait(delay, signal);
    if (signal.aborted) return;
    result = await steps.fileStatus(fileId);
  }
}
