// The malware scan: the worker's handler for files.file_uploaded (#63).
//
// It reads the stored object once, as a stream, and that one pass feeds the
// scanner, the SHA-256 and the type sniffer (the first bytes). The object
// is at the file's storage key, which no upload URL names: completing the
// upload moved it there (use-cases/upload.ts), so nothing can change it
// after this read, and a clean file is served as it was scanned. What the
// file becomes is scanOutcome's call (domain/scan-outcome.ts):
//   - clean        deliverable to anyone `can()` allows;
//   - quarantined  moved to `<prefix>quarantine/<id>`, audited, never
//                  delivered to anyone;
//   - rejected     its bytes aren't the declared type; the object is
//                  deleted and the file is never delivered.
//
// It fails closed. A scanner that gives no verdict throws, so the relay
// retries with backoff and then keeps the delivery as failed; meanwhile the
// file stays `scanning`, which only its uploader may open. Delivery is at
// least once, so it is safe to repeat: only a file still `uploaded` or
// `scanning` is scanned, and each status change is made only if nobody
// else made one first.
//
// Loads under plain Node (the worker): relative imports only.

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { fileAsset, type FileAssetRow } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { MalwareScanner, ScanVerdict } from "../../ports/malware-scanner";
import type { ObjectStorage } from "../../ports/storage";
import {
  nextFileStatus,
  type FileEvent,
  type FileStatus,
} from "./domain/file-status";
import { scanOutcome, type ScanOutcome } from "./domain/scan-outcome";
import {
  SNIFF_BYTES,
  sniffContentType,
  type SniffedContentType,
} from "./domain/sniff";
import { quarantineKeyFor, storagePrefixOf } from "./domain/storage-key";

export type ScanDeps = {
  db: AppDb;
  clock: Clock;
  storage: ObjectStorage;
  scanner: MalwareScanner;
};

/** Thrown so the relay retries: the file got no verdict this time. */
export class ScanFailedError extends Error {
  constructor(fileId: string, reason: string) {
    super(
      `File ${fileId} got no scan verdict and stays unscanned until a ` +
        `retry: ${reason}`
    );
    this.name = "ScanFailedError";
  }
}

const WORKER = { kind: "system", process: "worker" } as const;

const EVENT_FOR = {
  clean: "scan_passed",
  quarantined: "scan_found_malware",
  rejected: "scan_rejected",
} as const satisfies Record<string, FileEvent>;

export async function scanUploadedFile(
  deps: ScanDeps,
  { fileId }: { fileId: string }
): Promise<void> {
  const file = await startScan(deps, fileId);
  if (!file) return;
  const read = await readThroughScanner(deps, file);
  const outcome = scanOutcome({
    declaredType: file.contentType,
    sniffedType: read.sniffedType,
    verdict: trusted(read),
  });
  if (outcome.kind === "retry") {
    throw new ScanFailedError(fileId, outcome.message);
  }
  await settle(deps, file, outcome, read.sha256);
}

/**
 * Marks the file `scanning` and returns it, or null if it has nothing to
 * scan: gone, not uploaded yet, or already settled.
 */
async function startScan(
  { db, clock }: ScanDeps,
  fileId: string
): Promise<FileAssetRow | null> {
  const [file] = await db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (!file) return null;
  const status = nextFileStatus(file.status, "scan_started");
  if (!status) return null;
  const [started] = await db
    .update(fileAsset)
    .set({ status, updatedAt: clock.now() })
    .where(and(eq(fileAsset.id, fileId), eq(fileAsset.status, file.status)))
    .returning();
  return started ?? null;
}

type ScanRead = {
  verdict: ScanVerdict;
  sniffedType: SniffedContentType | null;
  /** Hex SHA-256 of the whole object; null if it wasn't read to its end. */
  sha256: string | null;
};

/**
 * Streams the object to the scanner, hashing and sniffing each chunk as
 * the scanner pulls it, so the hash covers exactly what the scanner read.
 */
async function readThroughScanner(
  { storage, scanner }: ScanDeps,
  file: FileAssetRow
): Promise<ScanRead> {
  const object = (
    await storage.read({ bucket: file.bucket, key: file.storageKey })
  ).getReader();
  const hash = createHash("sha256");
  let head: Uint8Array = new Uint8Array(0);
  let readToEnd = false;
  const observed = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await object.read();
        if (done) {
          readToEnd = true;
          controller.close();
          return;
        }
        hash.update(value);
        if (head.length < SNIFF_BYTES) {
          head = concat(head, value.subarray(0, SNIFF_BYTES - head.length));
        }
        controller.enqueue(value);
      },
      cancel: (reason) => object.cancel(reason),
    },
    // Nothing is read ahead of the scanner.
    { highWaterMark: 0 }
  );
  try {
    const verdict = await scanner.scan(observed);
    return {
      verdict,
      sniffedType: sniffContentType(head),
      sha256: readToEnd ? hash.digest("hex") : null,
    };
  } finally {
    // The scanner may have stopped early: stop reading the object too.
    if (!readToEnd) await object.cancel().catch(() => {});
  }
}

/**
 * The scanner's verdict, unless it passed a file it didn't read to the
 * end: then neither its pass nor the sniffed type can be trusted.
 */
function trusted({ verdict, sha256 }: ScanRead): ScanVerdict {
  return verdict.verdict === "clean" && sha256 === null
    ? {
        verdict: "error",
        message: "the scanner passed it without reading it to its end",
      }
    : verdict;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

/** Records the verdict, and moves or deletes the object to match. */
async function settle(
  { db, clock, storage }: ScanDeps,
  file: FileAssetRow,
  outcome: Extract<ScanOutcome, { kind: "settled" }>,
  sha256: string | null
): Promise<void> {
  const status = nextFileStatus(file.status, EVENT_FOR[outcome.status]);
  if (!status) {
    throw new Error(`A ${file.status} file can't become ${outcome.status}`);
  }
  const now = clock.now();
  const verdict = {
    status,
    scanResult: outcome.scanResult,
    sha256,
    scannedAt: now,
    updatedAt: now,
  };
  const object = { bucket: file.bucket, key: file.storageKey };

  if (status === "clean") {
    await recordVerdict(db, file, verdict);
    return;
  }
  // The object moves or goes inside the transaction: if that fails, the
  // verdict rolls back, the file stays `scanning` and the scan is retried.
  await db.transaction(async (tx) => {
    if (status === "rejected") {
      if (await recordVerdict(tx, file, verdict)) await storage.delete(object);
      return;
    }
    const to = quarantineKeyFor({
      prefix: storagePrefixOf(file),
      fileId: file.id,
    });
    if (!(await recordVerdict(tx, file, { ...verdict, storageKey: to }))) {
      return;
    }
    await recordAudit(
      tx,
      { clock, actor: WORKER },
      {
        action: "file.quarantined",
        entity: { type: "file_asset", id: file.id },
        before: { status: file.status, storageKey: file.storageKey },
        after: { status, storageKey: to, scanResult: outcome.scanResult },
        actorRole: null,
      }
    );
    await storage.move({ bucket: file.bucket, from: file.storageKey, to });
  });
}

/** Writes the verdict if the file is still as read; false if it wasn't. */
async function recordVerdict(
  db: AppDb,
  file: FileAssetRow,
  values: Partial<FileAssetRow> & { status: FileStatus }
): Promise<boolean> {
  const updated = await db
    .update(fileAsset)
    .set(values)
    .where(and(eq(fileAsset.id, file.id), eq(fileAsset.status, file.status)))
    .returning({ id: fileAsset.id });
  return updated.length > 0;
}
