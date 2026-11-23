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
//                  delivered to anyone (files.file_quarantined);
//   - rejected     its bytes aren't the declared type; the object is
//                  deleted and the file is never delivered
//                  (files.file_rejected).
//
// It fails closed. A scanner that gives no verdict throws, so the relay
// retries with backoff and then keeps the delivery as failed; meanwhile the
// file stays `scanning`, which only its uploader may open. A quarantine or
// rejection is committed (with its audit) before the object moves or goes,
// so from then on nobody can open the file whatever storage does; if the
// storage step fails it throws, and the retry finishes it. Delivery is at
// least once, so it is safe to repeat: only a file still `uploaded` or
// `scanning` is scanned, a quarantined or rejected one only has its storage
// step finished, and each status change is made only if nobody else made
// one first.
//
// Loads under plain Node (the worker): relative imports only.

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { fileAsset, type FileAssetRow } from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import type { MalwareScanner, ScanVerdict } from "../../ports/malware-scanner";
import { ObjectMissingError, type ObjectStorage } from "../../ports/storage";
import {
  nextFileStatus,
  type FileEvent,
  type FileStatus,
} from "./domain/file-status";
import { queueMediaWork } from "./process-image";
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
  const [current] = await deps.db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (!current) return;
  if (current.status === "quarantined" || current.status === "rejected") {
    // Settled by an earlier attempt whose storage step may not have finished.
    await finishStorage(deps, current);
    return;
  }
  const file = await startScan(deps, current);
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
  file: FileAssetRow
): Promise<FileAssetRow | null> {
  const fileId = file.id;
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

/**
 * Records the verdict, then moves or deletes the object to match. A file
 * that may not be delivered is marked so first, in its own transaction with
 * the audit, so a failed storage step can't leave it deliverable.
 */
async function settle(
  deps: ScanDeps,
  file: FileAssetRow,
  outcome: Extract<ScanOutcome, { kind: "settled" }>,
  sha256: string | null
): Promise<void> {
  const { db, clock } = deps;
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

  if (status === "clean") {
    // An image's derivatives are queued with the verdict (#85), never
    // before it.
    await db.transaction(async (tx) => {
      if (await recordVerdict(tx, file, verdict)) {
        await queueMediaWork(tx, clock, file);
      }
    });
    return;
  }
  const settled = await db.transaction(async (tx) => {
    if (!(await recordVerdict(tx, file, verdict))) return false;
    if (status === "quarantined") {
      await recordAudit(
        tx,
        { clock, actor: WORKER },
        {
          action: "file.quarantined",
          entity: { type: "file_asset", id: file.id },
          before: { status: file.status, storageKey: file.storageKey },
          after: {
            status,
            storageKey: quarantineKeyOf(file),
            scanResult: outcome.scanResult,
          },
          actorRole: null,
        }
      );
    }
    // A module whose upload this was hears of it with the verdict (#85).
    await emit(tx, clock, {
      type:
        status === "quarantined"
          ? "files.file_quarantined"
          : "files.file_rejected",
      aggregate: { type: "file_asset", id: file.id },
      payload: { fileId: file.id },
    });
    return true;
  });
  // Someone else settled it first; their attempt does the storage step.
  if (!settled) return;
  await finishStorage(deps, { ...file, status });
}

/**
 * The storage step of a quarantine or rejection, safe to repeat: the
 * object moves to the quarantine key (then the row follows it), or is
 * deleted. Throws if storage fails, so the relay retries.
 */
async function finishStorage(
  { db, clock, storage }: ScanDeps,
  file: FileAssetRow
): Promise<void> {
  if (file.status === "rejected") {
    await storage.delete({ bucket: file.bucket, key: file.storageKey });
    return;
  }
  const to = quarantineKeyOf(file);
  if (file.storageKey === to) return;
  try {
    await storage.move({ bucket: file.bucket, from: file.storageKey, to });
  } catch (error) {
    // An earlier attempt may have moved it and failed before the row
    // followed: then the object is already where it belongs.
    const alreadyMoved =
      error instanceof ObjectMissingError &&
      (await storage.head({ bucket: file.bucket, key: to })) !== null;
    if (!alreadyMoved) throw error;
  }
  await db
    .update(fileAsset)
    .set({ storageKey: to, updatedAt: clock.now() })
    .where(
      and(
        eq(fileAsset.id, file.id),
        eq(fileAsset.status, "quarantined"),
        eq(fileAsset.storageKey, file.storageKey)
      )
    );
}

function quarantineKeyOf(file: FileAssetRow): string {
  return quarantineKeyFor({ prefix: storagePrefixOf(file), fileId: file.id });
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
