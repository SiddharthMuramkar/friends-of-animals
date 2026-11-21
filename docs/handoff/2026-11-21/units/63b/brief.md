# Brief 63b: malware scan, ClamAV sidecar, quarantine

Unit 63b of #63 (M0). Branch `ticket/63-scanner`, worktree `/root/foa-wt/63b`. L, risk (A V), key X6. Blocked by 63a.
PR base `M0`, title `M0 #63: Private file uploads with malware scan and signed delivery (scanner)`.

## Scope
**In (63b):**
- `MalwareScanner` port: a ClamAV adapter (`clamd` INSTREAM over TCP), an in-memory fake that flags EICAR, and a shared contract.
- The scan job: the handler for 63a's `files.file_uploaded` event (61a's relay and drain). It moves the file `uploaded` → `scanning` → `clean`, `quarantined` or `rejected`.
- Magic-byte sniffing: the sniffed type must equal the declared type.
- sha256 recorded on the row.
- Quarantine moves the object to `<prefix>quarantine/<id>` and updates `storage_key`. The status gate (63a) stays the authority.
- Retry: a scanner outage leaves the file `scanning` and retries through 61a's backoff, ending visibly failed. It never fails open.
- Ops: the `clamav` service in `docker/workers.yml` (pinned tag, memory cap, healthcheck, `freshclam`), `docker/README.md`, worker env `CLAMD_HOST`/`CLAMD_PORT`.
- **Pure core on the branch (8d15869):** `src/server/modules/files/domain/{sniff.ts,scan-outcome.ts}` (`sniffContentType`, `SNIFF_BYTES`, `scanOutcome`) and `src/server/ports/clamd-protocol.ts` (`INSTREAM_COMMAND`, `PING_COMMAND`, `END_OF_STREAM`, `frameChunk`, `splitIntoChunks`, `MAX_CHUNK_BYTES`, `parseClamdReply`, `isPong`).
  - The branch was cut from `M0` before 63a, so merge `M0` (with 63a) first. The files don't overlap.
  - Slice 1 moves `ScanVerdict` into `ports/malware-scanner.ts`. `scan-outcome.ts` and `clamd-protocol.ts` (`ClamdVerdict`) then import it, so there is one verdict type.

**Out:** 63a owns the table, port, presign, delivery and gate. 63c owns purge, the demo page and the journey. #85 owns derivatives, EXIF stripping and HEIC.

## Acceptance criteria (numbered, with seam)
1. **Clean path** (seam1). Upload a PNG, `completeUpload`, then `await h.drain()`. The file is `clean`, with `scanned_at` from the clock, `sha256` set and `scan_result = 'OK'`. Staff can now get a URL (63a AC 2).
2. **EICAR quarantined** (seam1). Upload the EICAR bytes declared `application/pdf` and drain. The file is `quarantined` and `scan_result` holds the signature name. The object is at `<prefix>quarantine/<id>` and gone from its old key. `getFileDownloadUrl` refuses everyone (`file_unavailable`), owner and super admin included. An audit row `file.quarantined` is written by the system actor.
3. **Type mismatch** (seam1). Declared `image/png` with JPEG bytes ends `rejected` (`type_mismatch`) and is never delivered.
4. **Scanner down** (seam1). With `h.scanner.failNext(1)`, the first drain leaves `scanning`. After the backoff, a second drain makes it `clean`. If it always fails, the file never becomes `clean` and the job ends in 61a's failed list.
5. **Idempotent** (seam1). Draining twice or re-delivering the event scans once. A non-`uploaded` row is skipped.
6. **Protocol** (unit). INSTREAM framing: `zINSTREAM\0`, 4-byte big-endian length chunks, a zero-length terminator. Reply parsing covers `stream: OK`, `stream: <sig> FOUND`, `... ERROR` and `INSTREAM size limit exceeded`. **Done (pure core).**
7. **Sniffing** (unit). PNG, JPEG, WebP, PDF and unknown. `scanOutcome` covers the whole verdict-by-type table. **Done (pure core).**
8. **Sidecar config** (evidence + HR-08). `docker compose -f docker/workers.yml config` is valid. `clamav` has a healthcheck, a memory limit and no published port, and only the worker network reaches it.

## Files
- New: `src/server/ports/{malware-scanner.ts,malware-scanner.contract.ts,malware-scanner-clamav.ts}`; `clamd-protocol.ts` exists.
- New: `src/test/fakes/malware-scanner.ts` (+test); `src/server/modules/files/scan.ts` (job handler); `domain/{sniff,scan-outcome}.ts` exist.
- Touch: `src/server/deps.ts` and `src/test/harness.ts` (append `scanner`; X1 was 63a's, 63b appends one field after 63a merges); 61a's handler registry (one line); `src/env.schema.ts` (`CLAMD_HOST`, `CLAMD_PORT`, worker-only, optional outside production).
- X6: `docker/workers.yml` (the `clamav` service, plus scanner env on the worker services) and `docker/README.md`. Serialize with 61b, 66b and 68.
- No migration: 63a's enums already hold `scanning`, `quarantined` and `rejected`.

## Design
- **Scan in the worker job (chosen)**: it streams `ObjectStorage.read` straight into INSTREAM in chunks of at most 64 KiB, so the file is never buffered whole. The alternatives were scanning inside `completeUpload` on Vercel (no clamd reachable from Vercel, and it adds latency) and a bucket-event webhook (R2 event notifications need Queues, outside the locked stack). Both rejected.
- One pass over the stream feeds clamd, sha256 and the sniffer (first 16 bytes) together.
- `scanOutcome({declared, sniffed, verdict})` is pure and decides the status. The job only does I/O and `UPDATE ... WHERE status IN ('uploaded','scanning')`, which keeps it idempotent under at-least-once delivery.
- The scanner fails closed: an `error` verdict or a timeout throws, 61a retries, and the file stays undeliverable to others.
- The fake builds EICAR at runtime from two halves (`EICAR_TEST_BYTES`), so no literal signature sits in the repo for local antivirus to quarantine.

```ts
export type ScanVerdict = { verdict: "clean" } | { verdict: "infected"; signature: string } | { verdict: "error"; message: string };
export interface MalwareScanner { scan(stream: ReadableStream<Uint8Array>): Promise<ScanVerdict> }
```

## Interface needs
```ts
// 63a
ObjectStorage.read({ bucket, key }): Promise<ReadableStream<Uint8Array>>;
ObjectStorage.move({ bucket, from, to }): Promise<void>;
fileAsset table; FileStatus + nextFileStatus (scan_started / scan_passed / scan_found_malware / scan_rejected); quarantineKeyFor({ prefix, fileId }) (already in 63a's domain/storage-key.ts).
// 61a
registerHandler("files.file_uploaded", (ctx: UseCaseContext, e: { aggregateId: string; payload: { fileId: string } }) => Promise<void>);
// a thrown error = retry with backoff, then the failed list; h.drain(): Promise<void>
// 59a
AuditLog.write(tx, { actor: { kind: "system", process: "worker" }, action: "file.quarantined", entityType: "file_asset", entityId, before: { status }, after: { status: "quarantined" } });
```

## Residue
HR-08: deploy the ClamAV sidecar (about 1–1.5 GB RAM) and the scan job on the VPS, with R2 credentials in the worker env. Until then previews never reach `clean`, which gates 63c's journey. HR-07 (the worker deploy) comes first. W ≤ 6 while this runs on the VPS (F9).

## Test plan
- Unit (exists): `domain/sniff.test.ts`, `domain/scan-outcome.test.ts`, `ports/clamd-protocol.test.ts`.
- Seam 1: `src/server/modules/files/scan.test.ts` (ACs 1–5); `src/test/fakes/malware-scanner.test.ts` runs the contract against the fake.
- `malware-scanner-clamav.test.ts` runs against a local TCP stub (`node:net` server on port 0) speaking the clamd protocol. It's in `pnpm test`, with no Docker.
- Not run: a real clamd (HR-08), `docker compose config` on the VPS.

## Slices
1. Port, fake, contract, and the ClamAV adapter against the TCP stub (ACs 6, 7): `malware-scanner-clamav.test.ts` and `fakes/malware-scanner.test.ts`.
2. Scan job: clean, EICAR quarantine, mismatch, idempotency (ACs 1, 2, 3, 5): `scan.test.ts`.
3. Failure and retry through 61a's backoff (AC 4): `scan-retry.test.ts`.
4. `docker/workers.yml`, README, env schema (AC 8): config evidence in the PR.
