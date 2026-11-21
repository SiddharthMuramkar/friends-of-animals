# Brief 103c: visitor reports and immediate hide, audit-logged, moderation queue

Unit 103c of #103 · M4 · M · risk (A K) · no X key · branch `ticket/103-reports` · worktree `/root/foa-wt/103c` ·
blocked by 103a (and through it 57b's rate limiter, #58's PII columns, 59a, 61a, #62, #69). Runs in parallel with 103b.
Prepped by foa-p103 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140).

## Scope
**In (103c):** ticket AC 5. Schema `gallery-report.ts`: enums `gallery_report_reason` (unsafe, identifies_child,
not_their_work, other) and `gallery_report_status` (open, actioned, dismissed), table `gallery_report`; one migration
`--name 103_gallery_report`; use cases `reportGalleryItem` (visitor), `hideGalleryItem`, `restoreGalleryItem`,
`listGalleryReports`, `dismissGalleryReport`; setting `gallery.reportsPerIpPerHour` (5); inbox template for new reports
(#69); public page `/gallery/[entryCode]/report` (form + confirmation) and its link on 103a's item page; the hide button on
103a's `/admin/gallery`; `/admin/gallery/reports`; namespaces `galleryReport`, `adminGalleryReports`; data-inventory
rows (details, contact email, IP hash); preview seed; `tests/e2e/103-gallery-reports.spec.ts`.
**Out:** 103a owns `gallery_item`, the status machine and `transitionGalleryItem` (this unit only calls it); 103b owns
asset retraction and CDN purge inside that writer (so a hide purges once 103b is on `M4`); 103d the crawl; 117a builds
the cross-module admin queues on `listGalleryReports`.

## Acceptance checks
1. A visitor reports a published item (reason + optional details ≤ 1000 + optional contact email) → one `open` report,
   `ip_hash` = keyed hash of the IP (the raw IP is never stored), one audit row `gallery.reported`, one content-manager
   inbox item (fake). The result carries no item or report details. *Seam 1*
2. Unknown, draft, hidden or unpublished entry code → `not_found`; nothing stored. *Seam 1*
3. The 6th report from one IP within an hour → `rate_limited` with `retryAfter`, nothing stored; another IP passes; after
   the hour (fake clock) the first IP passes again; setting 3 applies without deploy. *Seam 1*
4. Honeypot field filled → the same success result, nothing stored, no inbox item. Details > 1000 → `details_too_long`;
   bad email → `invalid_contact`; unknown reason → `invalid_input` (zod). *Seam 1*
5. `hideGalleryItem({ itemId, reason, reportId? })` on a published item → `hidden` in the same request; public read models
   exclude it; tags revalidated (fake); audit `gallery.hidden` with the reason; every open report on the item →
   `actioned` (handled_by/at set). Hiding a non-published item → `invalid_transition`. *Seam 1*
6. `restoreGalleryItem` (hidden → draft) only while public-display consent is still valid
   (`no_public_display_consent` otherwise); re-stamp requested (#102 fake); audit `gallery.restored`. *Seam 1*
7. `dismissGalleryReport` → `dismissed`, audit; `actioned` and `dismissed` are terminal (literal transition table). *Seam 1*
8. Authz: content manager, staff admin, super admin ✓ for hide, restore, list, dismiss; member and competition manager ✗;
   visitor ✓ for `reportGalleryItem` only. *Seam 1*
9. `h.seed.preview()` twice leaves two open reports and one dismissed report on seeded items. *Seam 1*
10. Report form, confirmation and `/admin/gallery/reports` render accessibly, light + dark, no horizontal scroll at 320 px;
    the form works without JS. *Seam 2, written, Not run here*

## Files and hotspots
- New: `src/server/db/schema/gallery-report.ts` (+ barrel line, H1); `drizzle/NNNN_103_gallery_report.sql` (H2);
  `src/server/modules/gallery/{report,moderate}.ts` + tests; `src/server/modules/gallery/domain/report.ts` (reasons,
  status table, input normaliser) + test; `src/server/seed/gallery-reports.ts` (+ `seeders` line after 103a's, H6);
  `src/app/gallery/[entryCode]/report/{page.tsx,actions.ts,_components/*}`; `src/app/admin/gallery/reports/{page.tsx,
  actions.ts,_components/*}`; `messages/en-IN/{galleryReport,adminGalleryReports}.json` (+ `messages.ts`, H3).
- Edits in 103a's files (serial after 103a): item page (report link), admin page (hide button), `composeUseCases`.
- Append-only: `can()` policy (H8): `gallery.moderate`, `gallery.report`; settings catalogue (H7); template + event map
  (H9); data inventory (H5).

## Design (risk-flagged; no tournament, two shapes compared)
- **A. Gallery-specific report rows + manual moderation through 103a's writer (chosen).** One public command with every
  guard inside (`not_found`, honeypot, zod, rate limit, keyed IP hash, insert, audit, inbox) and one moderation command
  (`hideGalleryItem`) that also settles the open reports, so the queue and the item page can't disagree. Hide goes
  through `transitionGalleryItem`, so 103b's retraction and purge apply without this unit knowing about them (locality).
- **B. Generic `moderation_report` module for every public surface:** speculative until a second surface exists (117a
  reads ours through `listGalleryReports`). Rejected for now; the table moves later by add, backfill, drop.
- **Auto-hide after N reports** is not built: anyone could take down a child's work. HR-44 decides whether
  `identifies_child` should hide at once.
- PII: `details` and `contact_email` stored through #58's encrypted-column helper and decrypted only in
  `listGalleryReports`; never in logs or the inbox body (it links to the queue). Retention per HR-31.
- Public page: a Server Action form on a page under the public CSP (no nonce); `robots: { index: false }`; the action
  zod-validates and calls `reportGalleryItem` (visitor actor from the request); the confirmation shows no details.

## Interface needs (adopt the real names on `M4` at claim)
```ts
// 57b/58: limiter and request actor
hitRateLimit(ctx: UseCaseContext, rule: { scope: "ip"; key: string; max: number; windowMs: number }):
  Promise<{ ok: true } | { ok: false; retryAfter: Date }>;
actorFromRequest(req: Request | Headers): Promise<Actor>;
// keyed IP hash: reuse the limiter's if it exports one, else HMAC-SHA256(ip) keyed from BETTER_AUTH_SECRET + "gallery-report"
hashClientIp(ctx: UseCaseContext, ip: string): string;
// #58: encryptPii(value: string): Promise<EncryptedText>; decryptPii(value: EncryptedText): Promise<string>
// 103a: transitionGalleryItem(ctx, tx, { itemId, to: "hidden" | "draft", reason }); findPublishedItemByCode(db, code)
//       galleryEligibility(db, itemId): Promise<{ eligible: boolean }>
// #102: requestStamp(tx, clock, { sourceFileId, variant: "gallery" })
// 62: readSetting(db, "gallery.reportsPerIpPerHour"); #69: notify(ctx, { event: "gallery.reported", audience: "content_managers", data: { reportId } })
// 59a: authorize(ctx, "gallery.moderate"); recordAudit(tx, ctx, {...})
```

## Residue
HR-44 (FOA safeguarding: report reasons, reviewer, response time; auto-hide for `identifies_child`), HR-31 (retention of
report details, contact email and IP hash), HR-30 (365-day IP-derived data), HR-01 (Seam 2 on previews).

## Test plan
Seam 1 through `createHarness()` on 103a's seed builders; visitor actors with different `meta.ip`; `h.clock.advance` for
the window; inbox and revalidation fakes; authz matrix per use case; a literal table test for report statuses. Seam 2
spec with `expectRendersAccessibly` (+ `.dark`) on 3 pages, Not run.

## Slices
1. Schema, migration, `reportGalleryItem`, hide/restore/dismiss/list, setting, inbox, seed, pages, e2e spec (AC 1–10) ·
   `src/server/modules/gallery/report.test.ts` (+ `moderate.test.ts` in the same slice if the file grows past ~300 lines).
