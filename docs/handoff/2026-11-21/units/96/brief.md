# Brief 96: Blind scoring

| Unit | Issue | Branch | Worktree | Blocked by | Size, flags |
|---|---|---|---|---|---|
| 96 | #96 (M3) | `ticket/96-blind-scoring` | `/root/foa-wt/96` | 95c (and through it 95a, 95b), 86a, 86b (and through them 85a, 85b, 63a) | L · risk (K minors, A IDOR, PD) · B3 tournament · no siblings |

Head start on the branch: `3e5f8dd M3 #96: Add blind scoring domain core` (base `foa/M0` 442dd99, 56 unit tests), `src/server/modules/judging/blind/domain/` — `score-sheet.ts` (patch, field-level
optimistic concurrency, range/integer rules, completeness, progress), `scoring-access.ts` (read/write decision table, no existence leak),
`judging-media.ts` (which derived copy each slot uses, never the original; blind download names), `blind-entry-view.ts` (allow-list
projection + key-path helper for the no-PII test). Build on these; rebase onto `foa/M3` (or the trunk holding 95c/86a/86b) before slice 1.

## Scope
**In:** the judge's side of FOA judging: `/judge/rounds/[roundId]` (assigned entries, progress, filter by category/status) and
`/judge/rounds/[roundId]/entries/[entryCode]` (viewer + rubric form, prev/next); use cases `listMyAssignments`, `getBlindEntry`,
`saveScoreSheet`; tables `score_sheet`, `criterion_score`; the blind read model and its no-PII proof; a generic media viewer
(`src/components/media-viewer/`, full-viewport `<dialog>`, zoom, pan, video); autosave; audit on completion and later changes; seed; Seam 2 spec.
**Out (owners):** rounds, status machine, pinned rubric per discipline (95a); invitations, onboarding, round-scoped `judge` role (95b);
pool, assignment, conflicts (95c); derivatives (85a: image, 86a: video + poster, 86b: sanitised essay text + `pdf_clean`); signed delivery
(63a); rankings, lock, aggregation, the DB trigger on locked rounds, the M3 journey (#97). **Showing titles to judges** stays off (HR-40).
**Runtime check at claim:** `ls src/server/modules/{judging,entries,files}` and `grep -rn "round_assignment\|judge_onboarding\|file_derivative\|text_html" src/server/db/schema`
on trunk; adopt trunk names. If 95c's `round_assignment` has no unique (round, judge, entry), stop and report (the FK below needs it).

## Acceptance criteria (numbered, with the seam that proves each)
1. A judge with 2 of the round's 5 entries assigned gets exactly those 2 from `listMyAssignments({roundId})`, each with entry code, category, age group and progress (`not_started|in_progress|complete`); another judge's assignments never appear. Seam 1.
2. `getBlindEntry({roundId, entryCode})` for an unassigned entry, a missing code, or an entry of a round the judge isn't in fails `entry_not_found` with an identical error shape (no existence leak). Seam 1; decision table unit-tested (done).
3. No participant personal data: for an entry whose participant is "Aarav Sharma", school "St. Mary's", city "Pune", with guardian email + phone, registration number, title, description and statement set, `JSON.stringify(view)` contains none of those strings, and the view's key paths equal the allow-list exactly. Seam 1 (+ unit: projection drops extra fields, done). Import boundary: no file under `src/server/modules/judging/blind/` imports the registration, profile, institution or guardian schema/modules. Unit (fs scan test).
4. Work comes from derived copies via signed URLs: image → `display_1600` (+ `thumb_320` for the list), video → `transcode_mp4` + `poster`, typed essay → sanitised `text_html`, document essay → `pdf_clean`; a file with no suitable derivative shows `unavailable`, never the original. Signed URLs hold no participant id, registration number or original file name, and are refused after expiry (`clock.advance`). Seam 1 (+ unit: media plan, done).
5. Saving 7 on a 0–10 criterion and a comment, then calling `getBlindEntry` again (a "later sitting", new `as()`), returns 7 and the comment. Seam 1.
6. 11, −1, 7.5 and an unknown criterion id are refused (`out_of_range`, `not_an_integer`, `unknown_criterion`) and nothing is written. Unit (done) + Seam 1.
7. Partial save → `in_progress`, `score_sheet.complete = false`; every criterion → `complete`; clearing one (`null`) → `in_progress`. Unit (done) + Seam 1.
8. Two saves from the same `baseVersion` touching different criteria both persist (no lost update across criteria); a save that changes a criterion another save changed after its base is not applied to that criterion and returns it in `conflicts` with the stored value. Unit (done) + Seam 1.
9. Writes need an `open` round: `locked` → `round_locked` (read still works, read-only); `draft`/`cancelled` → `entry_not_found`. Seam 1.
10. A judge with the role but no completed onboarding gets `not_onboarded` from all three use cases. Seam 1.
11. Authz per use case: assigned judge passes; unassigned judge of the same round, judge of another round, competition manager, member and visitor fail. Seam 1.
12. One audit row `score_sheet.completed` when a sheet first becomes complete, then one `score_sheet.changed` (before/after values) per save that changes a complete sheet; none for saves before completion. Seam 1.
13. Viewer: opens as a full-viewport `<dialog>` (`100dvh`), zoom by buttons, `+`/`-`/`0` and pinch, pan by drag, Escape closes and returns focus; `<video controls playsinline preload="metadata">` plays (`currentTime > 0`) on the Pixel 7 project. Seam 2 (written, **Not run**).
14. Without JS the form posts the server action with an explicit Save button; with JS, debounced autosave and an `aria-live="polite"` "Saved" status. Seam 2 (written, **Not run**).
15. Preview seed: the seeded judge has assigned entries in the seeded open round — one image, one video, one essay — in each progress state. Seam 1 (seed test).
16. axe clean, light and `.dark`, desktop and mobile, on both pages and the open viewer. Seam 2 (written, **Not run**).

## Files
- New: `src/server/db/schema/scoring.ts` + one barrel line (H1, `merge=union`); one generated migration `96_score_sheets` (no enum changes;
  no use of #95's enum values in DDL); `src/server/modules/judging/blind/{index.ts,use-cases.ts,queries.ts,errors.ts,boundary.test.ts}` +
  `domain/*` (exists); `src/server/seed/scoring.ts` + one `seeders` line (H6).
- New pages: `src/app/judge/rounds/[roundId]/page.tsx`, `src/app/judge/rounds/[roundId]/entries/[entryCode]/{page.tsx,actions.ts,_components/*}`
  (inside 95b's judge layout, H23); `src/components/media-viewer/{media-viewer.tsx,zoom.ts,zoom.test.ts}` + a `/styleguide` block (append-only).
- Append-only touches: `src/server/app.ts` (`blindJudgingUseCases`), #59 policy table (`score.read`, `score.write`), `messages/en-IN/judging.json`
  (95b's namespace; add `judgeScoring` instead if 95b's file is busy, + 3 lines in `src/i18n/messages.ts`, H3), `app-routes.ts`.
- `tests/e2e/96-blind-scoring.spec.ts`. CSP: `img-src`/`media-src` must allow the R2 origin; if #65's registry lacks it, note it in the PR (X4, don't edit).

## Design (compared with `codebase-design` vocabulary)
- **A. Deep `judging/blind` module, allow-list projection, field-level optimistic patches (chosen).** The module's interface is three use
  cases and the branded `BlindEntryView`; queries select only allow-listed columns (entry code, discipline, category/age-group labels,
  derivative refs) and never join profile, registration, institution or guardian tables — enforced by the boundary test, not by review.
  Saves are patches `{baseVersion, scores: {criterionId: value|null}, comment?}`; each criterion row stores the sheet version that last
  changed it, so disjoint edits from two tabs both land and a same-field race reports a conflict instead of overwriting. One sheet row lock
  (`SELECT … FOR UPDATE`) per save. Leverage: #97 reads `score_sheet.complete` + `criterion_score` only; locality: blindness lives in one folder.
- **B. Whole-sheet save with a sheet-level version (rejected).** Simplest protocol, but a debounced autosave from a stale tab fails or
  overwrites every criterion; the no-JS full-form post and the JS path diverge. Fails "no lost update across criteria" without extra UX.
- **C. Postgres view `blind_entry` + whole-sheet save (rejected).** A DB view proves the column set in SQL, but needs custom-SQL
  migrations that every later entry/derivative change must regenerate (H2), and PGlite tests still need the app-level key-set check. The
  boundary test + projection give the same guarantee with ordinary schema.
- Per-criterion upsert without versions (variant of A) loses the same-field conflict signal; kept as the fallback if the tournament prefers it.
- Signed URLs: 63a's `presignGet` with `filename` from `blindMediaFilename()` (`work-<n>.<ext>`), `disposition: "inline"`, 5-minute expiry;
  the page re-fetches on expiry (the viewer reloads the entry). Keys are 85a's `<prefix><purpose>/<uuidv7>`: no PII by construction.
- Schema: `score_sheet(id uuid pk, round_id, entry_id, judge_user_id, comment text not null default '', comment_version int, complete bool,
  version int, completed_at null, created_at, updated_at; unique (round_id, judge_user_id, entry_id); FK (round_id, judge_user_id, entry_id) →
  round_assignment ON DELETE RESTRICT)`; `criterion_score(score_sheet_id fk, criterion_id fk → rubric_criterion, value smallint null,
  changed_at_version int, pk (score_sheet_id, criterion_id))`. A cleared criterion keeps its row with `value = null` and the
  version that cleared it, so a stale window can't restore it (`score-sheet.ts`). Range CHECK can't reference the rubric:
  enforced in the domain; #97's trigger guards locked rounds.
- Defaults (reversible, recorded): comment ≤ 2,000 chars, stored as typed; locked rounds readable by their judges; scoring needs `open`;
  "scored" = complete (no separate submit, #97 locks on it); no auto-redaction of essays (HR-46); titles hidden (HR-40); essays as PDF open via a link.

## Interface needs (what this unit codes against; adapt names at claim)
```ts
// 95a: rounds + pinned rubric
type JudgingRoundStatus = "draft" | "open" | "locked" | "cancelled";
// judging_round { id, competitionId, status }; judging_round_rubric { roundId, discipline, rubricId }
// 88: rubric_criterion { id, rubricId, position, label, description, weight, minScore: int, maxScore: int }
// 95b: function judgeOnboardingComplete(db: AppDb, input: { roundId: string; judgeUserId: string }): Promise<boolean>;
//      role "judge" scoped { type: "judging_round"; id } via can()
// 95c: round_assignment { roundId, judgeUserId, entryId, assignedAt } unique (roundId, judgeUserId, entryId)
// 85b/86b: entry { id, code, competitionId, discipline, categoryKey, ageGroupKey? }; entry_file { entryId, kind: "image"|"video"|"document"|"text",
//      status: "live"|…, fileAssetId, textHtml }   (only the live file is judged)
// 85a/86a/86b: file_derivative { fileAssetId, kind: "thumb_320"|"display_1600"|"poster"|"transcode_mp4"|"pdf_clean", storageKey, contentType,
//      width: number|null, height: number|null, durationMs: number|null }
// #70: function categoryLabel(competitionId: string, key: string): string; ageGroupLabel(competitionId: string, key: string): string
// 63a: storage.presignGet({ bucket, key, expiresInSeconds, contentType, disposition: "inline", filename }): Promise<{ url: string }>
// 59a: can(actor, "score.read" | "score.write", { type: "judging_round"; id: string }): Promise<boolean>;
//      AuditLog.write(tx, { actor, action: "score_sheet.completed" | "score_sheet.changed", entityType: "score_sheet", entityId, before, after })
// harness: h.seed.judge({ round, assignedEntries }), h.seed.entry({ discipline, participant: {...PII} }), h.storage.get(url)
```

## Residue
- HR-40: whether judges see entry titles (default hidden). HR-46: essay text shown as submitted, names included, no auto-redaction (flag in PR).
- HR-28: real-device checks; iOS Safari is untested in CI (no WebKit project) — say so in the PR body.

## Test plan
- Unit (done): `domain/*.test.ts`. Unit (slice 1): `blind/boundary.test.ts` (import scan), `media-viewer/zoom.test.ts`.
- Seam 1 (`createHarness()`, PGlite, fake clock, storage fake): one file per slice; authz allow + deny per use case.
- Seam 2: `tests/e2e/96-blind-scoring.spec.ts` (seeded judge, both pages, viewer zoom/Escape, video on mobile, no seeded participant
  name on either page, `expectRendersAccessibly` light + dark). **Not run** here (no Postgres server; previews fail at `pnpm db:migrate`).

## Slices (ordered; each = one behaviour, one test file)
1. Schema + migration + `listMyAssignments` with progress, onboarding gate, authz (ACs 1, 10, 11 list) → `blind/assignments.test.ts`.
2. `getBlindEntry`: access table, blind projection, signed derived media, no-PII field test, boundary test (ACs 2, 3, 4, 9 read, 11) → `blind/blind-entry.test.ts`, `blind/boundary.test.ts`.
3. `saveScoreSheet`: ranges, completeness, conflicts, lock, audit (ACs 5–9, 12, 11 write) → `blind/save-score-sheet.test.ts`.
4. Preview seed (AC 15) → `src/server/seed/scoring.test.ts`; media viewer zoom reducer → `src/components/media-viewer/zoom.test.ts`.
5. Pages, server action (no-JS + autosave), viewer, messages, Seam 2 spec (ACs 13, 14, 16) → `tests/e2e/96-blind-scoring.spec.ts`.
