# Brief 103b: consent withdrawal unpublishes and purges the CDN copy within the time limit

Unit 103b of #103 · M4 · M · risk (K) · no X key, **but touches X1** (`src/server/deps.ts`, `src/test/harness.ts`,
`src/test/fakes/*`) for the new port: the orchestrator should serialize it with other X1 holders · branch
`ticket/103-purge` · worktree `/root/foa-wt/103b` · blocked by 103a (and through it #102, 99b, #82, 61a, #62, #63).
Runs in parallel with 103c. Prepped by foa-p103 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140).

## Scope
**In (103b):** ticket AC 3. The gallery's `consent.withdrawn` consumer; asset retraction inside 103a's single status
writer `transitionGalleryItem` for every move out of `published` (so 103c's hide gets it too); the new **CdnPurge**
module: `cdn_purge` table, `requestCdnPurge`, the purge handler with deadline-bounded retries, the overdue alert; the new
`CdnPurger` port (Cloudflare adapter, log-only adapter when no CDN is configured, in-memory fake, contract suite); setting
`gallery.withdrawalPurgeMinutes` (default 15, range 1–1440) in #62's catalogue; consumer + handler registration; the
alert's inbox template (#69). **Pure core already on the branch** (see "Head start").
**Out:** 103a owns the gallery tables, statuses, pages and `PublicAssetUrl`; 103c owns hide/restore and reports (its hide
calls the writer this unit extends); 103d the crawl; #104 its own social-queue withdrawal consumer.

## Acceptance checks
1. Emit `consent.withdrawn` (purpose `public_display`) for a subject with a published item at T, drain → item
   `unpublished`, reason `consent_withdrawn`, `unpublished_at` = drain time; public read models exclude it; tags
   `gallery` + `gallery:<code>` revalidated (fake); one audit row, system actor. Draft and hidden items of that subject
   also become `unpublished`. Redelivery changes nothing. *Seam 1*
2. Withdrawal of `display_school` or `display_city` only revalidates the item's tags (credit changes on next render);
   the item stays published. Withdrawal for another competition's consent touches nothing (consent is per competition). *Seam 1*
3. Leaving `published` deletes the item's stamped objects from the public bucket (storage fake), retracts the stamped
   derivative rows through #102's API, and writes one `cdn_purge` row with the item's public URLs (full + every `srcset`
   size), `deadline_at` = T + `gallery.withdrawalPurgeMinutes` (T = the event's `occurredAt`, not drain time). *Seam 1*
4. The purge handler calls the `CdnPurger` fake with exactly those URLs, sets `completed_at` ≤ deadline. *Seam 1*
5. Purge failure → retried per `nextPurgeStep` (attempts and `last_error` stored, next attempt never after the
   deadline); still failing once the deadline passes → one `cdn.purge_overdue` event (content managers' inbox + log),
   retries continue every 10 min until 24 h after T, then `failed` with a second alert. Fake clock drives it. *Seam 1 +
   Vitest (done for the schedule)*
6. Setting change applies without deploy: `gallery.withdrawalPurgeMinutes` = 5 → next withdrawal's deadline is T + 5 min;
   values outside 1–1440 refused by #62's schema. *Seam 1*
7. `CdnPurger` contract: the fake and the Cloudflare adapter (request shape only, fetch stubbed) pass one suite: batches
   of ≤ 30 URLs per call, absolute https URLs only, a 429/5xx is retryable, a 4xx auth error is not. Log-only adapter
   resolves and logs the count, never the URLs. *Vitest contract*
8. A system-only path: no actor other than the worker or drain can call the consumer or handler (they are not use cases
   on `as(actor)`); `requestCdnPurge` has no `can()` because only modules call it. Stated in the PR. *Review*

## Files and hotspots
- Head start (committed): `src/server/modules/cdn-purge/domain/schedule.ts` + test.
- New: `src/server/db/schema/cdn-purge.ts` (+ barrel line, H1); `drizzle/NNNN_103_cdn_purge.sql` (H2, one migration;
  enum `cdn_purge_status` pending|completed|failed in full); `src/server/modules/cdn-purge/{index,request,handle}.ts`
  + tests; `src/server/modules/gallery/withdrawal.ts` + test; `src/server/ports/cdn-purger{,.contract,-cloudflare}.ts`;
  `src/test/fakes/cdn-purger.ts` (+ test).
- Append-only: `src/server/deps.ts` + `src/test/harness.ts` (`cdn: CdnPurger`, X1); consumer/handler registry (H9);
  settings catalogue (H7); message template + event map (H9); `src/env.schema.ts` `CLOUDFLARE_ZONE_ID`,
  `CLOUDFLARE_PURGE_TOKEN` (optional; serialize); 103a's `transition.ts` (one call into `retractPublicAssets`).
- Data inventory: none (URLs and ids only).

## Design (risk-flagged: two tournament contenders + one more)
- **A. Synchronous unpublish in the consumer + purge request row driven by outbox events (chosen).** The consumer does
  only DB work in one transaction: writer → `unpublished`, retract derivative rows, insert `cdn_purge`, `emit
  cdn.purge_requested`. The handler deletes objects, calls `CdnPurger.purge(urls)`, and on failure stores the attempt and
  re-emits itself with `availableAt` from the pure `nextPurgeStep`, so the deadline logic lives in one tested function
  instead of 61a's generic backoff (which may wait past 15 min). The page is off the public site as soon as the
  transaction commits and the tags are revalidated; the CDN step is idempotent and retryable. Interface: modules call one
  function, `requestCdnPurge(tx, clock, { urls, reason, deadlineAt })` (deep: retries, batching, alerting, adapters hidden).
- **B. Purge queue drained by a high-priority pg-boss schedule with an SLA monitor:** a second scheduler path (#61b),
  a polling interval that eats into the SLA, and a monitor to test. Rejected: more moving parts for the same guarantee.
- **C. Purge inline in the consumer:** a CDN outage would roll back the unpublish or leave it half-done. Rejected.
- **Why delete the public objects:** an R2 public bucket refetches from origin after a purge, so purge alone does not
  remove the copy. Leaving `published` deletes the stamped objects; returning (103c restore, re-pick) goes through
  `draft` and re-stamps (#102), so no path republishes without fresh consent and a fresh stamp.
- Revalidation runs in the consumer (99b's `revalidatePublicTags`, which reaches Next from the worker through the
  internal route). The 15-min `cacheLife.expire` from 103a bounds staleness if that call fails.

## Interface needs (adopt the real names on `M4` at claim)
```ts
// #82 / 64: event (payload ids only)
type ConsentWithdrawn = { type: "consent.withdrawn"; occurredAt: Date; payload: { consentEventId: string;
  subjectType: ConsentSubjectType; subjectId: string; purpose: ConsentPurpose; competitionId: string | null } };
// 61a: emit(tx, clock, event, { availableAt? }); registerConsumer("consent.withdrawn", handler); h.drain()
// 62: readSetting(db, "gallery.withdrawalPurgeMinutes"): Promise<number>
// 103a: transitionGalleryItem(ctx, tx, { itemId, to: "unpublished", reason: "consent_withdrawn" });
//       galleryItemsOfSubject(tx, subject, competitionId): Promise<GalleryItemRow[]>; publicImagesOf(item): PublicAssetUrl[]
// #102: retractStampedDerivative(tx, { outputFileId }): Promise<{ bucket: string; key: string }>  // marks the file deleted
// 63a: ObjectStorage.delete({ bucket, key })
// 99b: revalidatePublicTags(ctx, tags)
// #69: notify(ctx, { event: "cdn.purge_overdue", audience: "content_managers", data: { purgeId, deadlineAt } })
export interface CdnPurger { purge(urls: readonly string[]): Promise<void> } // rejects CdnPurgeError { retryable }
```

## Head start (pure core, Vitest only), commit on `ticket/103-purge`, `pnpm check` green
`cdn-purge/domain/schedule.ts`: `PURGE_LIMITS` (1–1440 min, hard 24 h, retry ladder), `purgeDeadlines(withdrawnAt,
minutes)` → `{ deadlineAt, hardDeadlineAt }`, `nextPurgeStep({ deadlineAt, hardDeadlineAt, failedAttempts,
overdueAlerted }, now)` → `{ kind: "retry", at, alert: "none" | "overdue" } | { kind: "give_up", alert: "failed" }`.

## Residue
HR-30 (counsel confirms the withdrawal time limit: default 15 min, hard 24 h; R-SLA), HR-13 (zone id + purge token;
until then the log-only adapter), HR-10 (redeploy `worker-preview` so the preview runs this consumer), HR-44 (who
receives the overdue alert).

## Test plan
Vitest for the schedule (done) and the port contract. Seam 1 through `createHarness()`: seed a published item (103a's
builders), emit the event with `emit`, `h.drain()`, assert rows, storage fake, `h.cdn.purges`, revalidation fake, inbox.
Failure paths with `h.cdn.failNext(n)` and `h.clock.advance`. No Seam 2 (no page).

## Slices
1. Port + fake + contract, table + migration, `requestCdnPurge` + handler, withdrawal consumer, setting, alert (AC 1–8)
   · `src/server/modules/gallery/withdrawal.test.ts` (+ `cdn-purger.contract` run by the fake's test).
