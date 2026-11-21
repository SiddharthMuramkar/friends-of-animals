# Brief 86a: Video entries: transcode, poster and limits

Unit 86a · issue #86 · M2 · size L · risk K C V PD · key X6 · blocked by 85b (and so 85a, 63a/63b, 61a/61b) · branch
`ticket/86-video` · worktree `/root/foa-wt/86a` · base `442dd99` (foa/M0). Sibling **86b** owns essays and the sanitiser.
Owner ruling on #86 (2026-11-19) concerns essays only. #55's only decision comment (Gotenberg 9) doesn't touch this unit.

## Scope
- **In:** the videography discipline end to end on 85b's entries pipeline. Common phone formats are accepted (MP4, MOV, 3GP and
  WebM). The size and length limits are checked in the browser, at `startEntryUpload`, at `completeEntryUpload` (size) and in
  worker-media (length, from ffprobe). worker-media transcodes to H.264/AAC MP4 (`+faststart`, at most 1080p, every bit of
  metadata dropped) and makes a JPEG poster. The original stays private. The detail page plays the transcoded copy with its
  poster. A processing failure leaves a clear `failed` state with a "try again" message. Also: the ffmpeg adapter, ffmpeg in the
  worker-media image, ClamAV's stream limit raised for 200 MB videos, the seed video entry, and the axe spec.
- **Out:** the Entry ID, the deadline, replacement, retry and the receipt template (all **85b**, reused unchanged). The image
  pipeline and the `MediaProcessor` port itself (**85a**). Essays, documents and the sanitiser (**86b**). Coordinator submit
  (**87**: videos reach coordinators through 85b's submitter policy automatically). Multipart upload for slow connections is a
  follow-up.

## Acceptance checks (Seam 1 unless stated)
1. **Video submits and plays.** For a VIDEOGRAPHY registration, `as(participant).startEntryUpload({…, contentType:"video/quicktime",
   sizeBytes, durationMs})` → storage-fake PUT → `completeEntryUpload` makes the entry `processing`. Then `drain()`: scanner clean,
   media fake with a 40 s probe. The entry is `submitted` and `entry.submitted` is emitted (85b's receipt). `getEntry({code})`
   returns `video: { url, posterUrl }`, signed URLs to the `transcode_mp4` and `poster` derivatives, and never the original key.
2. **Size limit, both sides.** Over 200 MB is refused at `startEntryUpload` (`too_large`, no row). If the stored object's HEAD size
   differs, `completeEntryUpload` refuses (63a's rule). `checkVideoUpload` (the browser check) refuses the same file.
   **Built:** `checkVideoUpload` is pure, and the form imports it.
3. **Length limit, both sides.** A browser-reported `durationMs` over 3 min is refused at `startEntryUpload` (`too_long`). The
   browser check refuses it too. With no reported duration (the browser can't read HEVC), the upload proceeds. A fake probe of
   3 min 1 s ends with the entry `failed`, reason `too_long`, the file `failed` and `entry.failed` emitted with the "too long, try a
   shorter clip" copy. No derivative rows exist.
4. **Metadata stripped.** The ffmpeg argv always has `-map_metadata -1`, `-map_chapters -1`, `-sn -dn`, bitexact flags, and maps only
   the first video and the first audio stream. **Built:** `transcodeArgs`/`posterArgs` tests. The real adapter contract (the
   worker-media image target, Not run here) runs `gps.mov` (1 s, ISO6709 location, make and model) through ffprobe on the output:
   no `location`, `creation_time`, `make` or `model` tags, codecs h264/aac, and the poster decodes.
5. **Failure is clear, and retry works.** `h.media.failNextVideo("transcode_failed")` → entry `failed`, participant told to try
   again. Retry before the deadline → `processing` → `submitted`. A transient adapter error (thrown) leaves the entry `processing`,
   and the outbox retries it (61a). Replacing a live video: the old one stays live until the new one is live (85b's rule, one test).
6. **Sniffed type.** Real MP4/MOV/3GP/WebM bytes pass 63b's declared-vs-sniffed check. MOV bytes declared `video/mp4` pass (same
   ISO-BMFF family), and PNG bytes declared `video/mp4` are `rejected`. **Built:** `sniffVideoType` and `sameVideoFamily`.
7. **Authz.** The use cases 86a extends (`startEntryUpload`, `completeEntryUpload` and `getEntry` for video) are tested over actors:
   the participant and the guardian of the ward pass. Another participant, a coordinator on the individual route, a member and a
   visitor get `forbidden`. A competition manager may read `getEntry` only once the entry is `submitted` (85b's staff rule).
8. **axe** (Seam 2, written, **Not run**). `tests/e2e/86-video.spec.ts` visits the video submit form and a seeded `submitted` video
   entry's detail page (`<video controls poster>`) and runs `expectRendersAccessibly` in both themes.

## Files
- **Built (head start):**
  - `src/server/modules/files/domain/{video-probe,video-transcode,video-sniff}.ts` + tests;
  - `src/server/modules/entries/domain/video-upload.ts` + test.
- **New:**
  - `src/server/ports/media-processor-ffmpeg.ts` (spawns ffprobe and ffmpeg with the built argv, timeout from the plan) + test;
  - `src/test/fakes/media-processor.ts` additions: `processVideo`, `nextVideo(probe)`, `failNextVideo(reason)`;
  - video cases in 85a's `media-processor.contract.ts`;
  - `fixtures/media/gps.mov`, made once with ffmpeg on the VPS or in the image build and committed;
  - `src/app/dashboard/entries/_components/video-entry-form.tsx` (client island: `<video>` `loadedmetadata` on an object URL) and
    `video-player.tsx`;
  - `messages/en-IN/entriesVideo.json`;
  - `tests/e2e/86-video.spec.ts`.
- **Hotspots (append only):**
  - **H21:** 85a's media profile registry gets `entry_video → processVideo`, and the derivative kinds registry gets
    `transcode_mp4` and `poster`.
  - **H22/H23:** 85b's `upload-rules.ts` gains video types and an optional `maxDurationMs`, folding `checkVideoUpload` in. Its
    failure reasons gain `too_long` and `transcode_failed`.
  - **H26:** the new-entry page picks the video form for VIDEOGRAPHY, and the detail page renders `video-player`.
  - 63a's `purposes.ts`: add `entry_video` (types above, 200 MB). Enum value through `--custom 86_pre_enum_entry_video`
    (`ADD VALUE IF NOT EXISTS`), unused in this PR's DDL (F2). Skip it if 85b already added the value.
  - 63b's `sniff.ts`/`scan-outcome.ts`: the video signatures and the family rule.
  - **X6:** `docker/worker-media/Dockerfile` gets `ffmpeg` from Debian bookworm, an LGPL-clean distro build. In
    `docker/workers.yml`, ClamAV gets `StreamMaxLength`/`MaxScanSize`/`MaxFileSize` of 210M. clamd's default 25 MB would make
    every video `error`, and the scan job retries forever.
  - **X4 (not held):** the CSP needs `media-src` for the signed R2 host. If 85b's `img-src` entry in #65's registry doesn't also
    add `media-src`, the orchestrator must grant X4 or 85b adds it. Flag this in the PR.
  - H1/H2: no new table. The only migration is the custom enum file. H3: one namespace. H6: a seed video entry with derivative
    rows pointing at a committed sample.
  - Merge order Q2: 85b → 87 → 86a → 86b.

## Design (risk-flagged; codebase-design vocabulary)
- **V1 (chosen): one deep port call per video.** `MediaProcessor.processVideo({ bucket, key, outputPrefix, limits })` does
  probe → `planVideoTranscode` (pure) → transcode → poster in one worker-media job. It returns typed permanent failures and
  **throws** only transient ones, so the outbox retries those. The fake runs the same pure planner over a configured probe, so the
  length rule can't drift between the fake and ffmpeg. One round trip, one job and one event per video. The length rule has
  locality in `video-transcode.ts`, and the tests use the same interface the worker does.
- **V2: two jobs** (a quick `probeVideo` job that rejects early, then `transcodeVideo`), with a three-method port (probe,
  transcode, poster). The interface is shallower, and the module has to orchestrate three calls and two events. Its only gain,
  early rejection, also happens inside V1 because the probe runs first. Rejected.
- **V3: trust the browser's duration.** It fails AC 3's server half, since browsers can't read HEVC in Chrome or Firefox. Rejected:
  the browser check is a convenience, and ffprobe is the authority.
- **Transcode profile** (pure `transcodeArgs`): libx264 High, `yuv420p`, CRF 23, preset `veryfast` (the CPU is shared with pg-prod,
  F12), AAC 128k at 48 kHz, `+faststart`. Autorotate stays on, and the output fits 1920×1080 by orientation, even dimensions, no
  upscaling. `-t` is capped at the limit as a backstop against a lying probe. The poster is one JPEG frame at min(1 s, duration/2),
  at most 1280 px. The job timeout is max(2 min, 4 × duration) + 1 min.
- **No new table:** derivatives are 85a's `file_derivative` rows (`duration_ms`, `width` and `height` set). Failure reasons live on
  85b's file row and transition reason.

## Interface needs (code against these; adapt names at claim)
```ts
// 85b entries (domain/status.ts, submission.ts, upload-rules.ts on ticket/85-*)
type EntryStatus = (typeof ENTRY_STATUSES)[number]; type EntryFileStatus = (typeof ENTRY_FILE_STATUSES)[number];
startEntryUpload(i: { registrationId: string; title: string; description?: string; fileName: string; contentType: string; sizeBytes: number; durationMs?: number | null })
  : Promise<{ entryFileId: string; upload: { url: string; headers: Record<string, string>; expiresAt: Date } }>;
completeEntryUpload(i: { entryFileId: string }): Promise<{ entryId: string; code: string; status: EntryStatus; replacement: boolean }>;
applyEntryFileOutcome(ctx: UseCaseContext, i: { fileAssetId: string; outcome: "live" | "infected" | "failed"; reason?: "decode_failed" | "too_long" | "transcode_failed" | "no_video_stream" }): Promise<void>;
getEntry(i: { code: string }): Promise<EntryDetail>; // 86a adds `video: { url: string; posterUrl: string } | null`
type UploadRule = { acceptedTypes: readonly string[]; maxBytes: number; maxDurationMs?: number | null }; // widened from image-only
uploadRuleFor(db: AppDb, competitionId: string, discipline: Discipline): Promise<UploadRule>; // competition_entry_rule or code default
// 85a media (files module, H21)
interface MediaProcessor {
  processImage(i: { bucket: string; key: string; outputPrefix: string }): Promise<ImageProcessingResult>;
  processVideo(i: { bucket: string; key: string; outputPrefix: string; limits: { maxDurationMs: number } }): Promise<VideoProcessingResult>; // 86a adds
}
type VideoProcessingResult =
  | { ok: true; probe: VideoProbe; derivatives: { kind: "transcode_mp4" | "poster"; key: string; contentType: string; width: number; height: number; durationMs: number | null; bytes: number }[] }
  | { ok: false; reason: "too_long" | "no_video_stream" | "decode_failed" | "transcode_failed" };
registerMediaProfile(purpose: FilePurpose, run: (ctx: UseCaseContext, file: FileAsset) => Promise<MediaOutcome>): void;
getDerivativeUrl(ctx: UseCaseContext, i: { fileId: string; kind: DerivativeKind }): Promise<{ url: string; expiresAt: Date }>;
// 63a/63b files: PURPOSE_RULES[purpose] = { contentTypes, maxBytes, environments }; sniffContentType(head) and scanOutcome(...)
// 61a outbox: emit(tx, clock, event, { availableAt? }); handler lease must exceed the transcode timeout: registerHandler(type, fn, { leaseMs })
```

## Residue
- **HR-35:** deploy worker-media with ffmpeg and the CPU, memory and pids limits. Raise ClamAV's stream limit on the VPS. Until then,
  preview videos stay `processing`.
- **HR-37:** the 200 MB and 3 min limits, and the accepted formats. **HR-36:** the copy for "processing failed" and "too long", and
  the ffmpeg licence note (Debian's LGPL/GPL build, which self-hosted use doesn't trigger).
- **HR-06/HR-08:** the non-prod R2 bucket and ClamAV for preview uploads. **HR-14:** the SMS DLT template if `entry_processing_failed`
  gets an SMS.

## Test plan
- **Unit (built):** `video-probe.test.ts`, `video-transcode.test.ts`, `video-sniff.test.ts`, `video-upload.test.ts`.
- **Seam 1:** `src/server/modules/entries/video.test.ts` (ACs 1–3, 5–7) and `media-processor-ffmpeg.test.ts`. The second fakes
  `spawn`: argv, timeout kill, and stderr mapped to typed failures.
- **Contract:** 85a's suite gets video cases. The fake runs in `pnpm test`. ffmpeg runs only in the worker-media image target
  (`pnpm test:media`), since ffmpeg isn't installed here. Never skip-if-missing (F3). Listed as Not run.
- **Seam 2:** `tests/e2e/86-video.spec.ts`, Not run (no Postgres).

## Slices (L → 4)
1. **Limits:** video uploads start and complete within size and length (ACs 2, 3 browser and start, 6, 7 part).
   `entries/video-upload.test.ts` (Seam 1).
2. **Processing:** `processVideo` on the port, fake and contract. The outcome makes the entry `submitted` or `failed` with a reason,
   and retry works (ACs 3 server, 5). `entries/video-processing.test.ts`.
3. **Playback:** `getEntry` returns signed transcode and poster URLs, never the original. Forms, player, namespace, seed, axe spec
   (ACs 1, 7, 8). `entries/video-playback.test.ts`.
4. **ffmpeg adapter:** argv from the built core, the spawn wrapper, the Dockerfile, ClamAV limits and compose limits (AC 4).
   `src/server/ports/media-processor-ffmpeg.test.ts`.
