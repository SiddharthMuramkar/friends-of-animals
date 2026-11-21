// The handler for files.file_uploaded: the malware scan. The scanner port,
// the ClamAV adapter and this job arrive with #63's scanner unit. Until
// then it fails closed: every delivery fails and is retried with backoff,
// then waits in the failed list, and the file stays `uploaded`, so nobody
// but its uploader can open it. Once the scanner lands, retrying those
// deliveries scans the files.
//
// Loads under plain Node (the worker): relative imports only.

import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";

export class ScannerNotWiredError extends Error {
  constructor() {
    super(
      "The malware scanner isn't wired yet (#63 scanner unit); the file " +
        "stays unscanned and undeliverable to anyone but its uploader."
    );
    this.name = "ScannerNotWiredError";
  }
}

export async function scanUploadedFile(
  _deps: { db: AppDb; clock: Clock },
  _payload: { fileId: string }
): Promise<void> {
  throw new ScannerNotWiredError();
}
