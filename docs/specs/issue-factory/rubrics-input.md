# Rubrics input: self-judging system (tournaments + final ticket review)

Design input for the spec sections on charter decisions 5-7. Sources read in full: CHARTER.md (decisions 1, 5-7), `.claude/skills/{code-review,codebase-design,tdd}/**`,
tickets #57/#106/#83 (`raw-open.json`), `spec55.md`, `spec-55.md` (Testing Decisions, Schema shape), `code-ui.md` §4-9, `code-infra.md` §3-5, `history-a.md` §5-7,
`skills-1.md` §0.3/§8, `skills-2.md` §6. Proposed home on trunk: `docs/factory/rubric.md` with header `rubric_version: r1`; every verdict JSON carries that version.

## 1. Scoring conventions (both rubrics)
- Scale 0-4. 0 absent or wrong; 1 major defect; 2 partial, defects remain (the DEFAULT when evidence is thin); 3 meets the bar, evidenced; 4 exemplary, evidenced twice
  independently. Evidence = `path:line` at the head SHA, a test name, or a command plus an output excerpt. A 3 needs >=1 evidence item, a 4 needs >=2; every score
  below 4 states "why not one higher".
- Applicability: R1-R4, R8, R9 are always scored. R5, R6, R7, R10, R11, R12 have a trigger (below); `applicable:false` must quote the check that came back empty, e.g.
  `git diff --name-only factory/trunk...HEAD -- src/server/db/schema drizzle`.
- Risk flags (ticket table in `spec55.md`): A auth/security, $ money, K minors/consent, E encrypted columns, C CSP. Any flag => 3 judges (decision 6) and the raised
  minimums in §3; no flag => 1 judge.
- The two code-review axes stay separate: R1 = Spec axis, R9 = Standards axis. Never merge, net off or rerank findings across them.
- Deterministic gates outrank judges: red `pnpm check`, `pnpm build`, `pnpm check:build`, CI check `Lint, typecheck, format, Vitest`, or status
  `E2E: Playwright and axe on the preview` = FAIL whatever the scores.

## 2. Final ticket review rubric (R1-R12)
**R1 Spec conformance** (always; Spec axis). Sources: ticket "What to build", #55 Implementation Decisions and rulings, owner comments, locked stack (history-a R1).
0: contradicts a ruling or the locked stack (OTP via queue, money as `numeric`/float, `VERCEL_ENV`, Vercel Cron, Redis/Prisma/Auth.js). 1: a "What to build" bullet
missing, or builds a "comes later" item (#106 adding recurring donations). 2: all bullets present, >=1 contradicts its quoted spec line, or an uncited deviation from the
suggested implementation. 3: every bullet matches; deviations cited in the PR ("This differs from the suggested ..."); no scope creep. 4: 3 + every bullet traced to
`path:line`, and the module interface exposes what #55's "Extended by" tickets need as clean seams, not stubs (#57's identity module ready for phone OTP #58, roles #59).

**R2 Acceptance-criteria coverage** (always). 0: an AC with no test, no residue child and no mention. 1: >=2 ACs backed only by claims or by tests that do not exercise
them. 2: every AC mapped, >=1 weakly (#106 "replayed webhook changes nothing" asserting postings but not receipts; #83 "links can't be reused" testing expiry only).
3: every AC mapped to a test that goes red if the AC is violated, or to a `ready-for-human` child linked with `Refs`. 4: 3 + every skeptic verdict `upheld`; AC->test
table in the PR body; boilerplate ACs (authz per use case, data inventory entry, seed extension, axe) each evidenced. A verified `refuted` AC caps R2 at 1.

**R3 Test quality, Seam 1 / Seam 2** (always; `tdd` skill + #55 Testing Decisions). 0: new behaviour untested, or any `.skip`, `.only`, `test.fixme`, `it.todo` on a
required case, deleted assertion, retries, axe `.disableRules()/.exclude()/.withTags()`. 1: `vi.mock` of internal modules (allowed: the `@/server/db` swap to
`createTestDb`, provider ports), verification through raw SQL instead of the use case or audit search, tautological expected values, real timers or sleeps. 2: Seam 1
used but a transition table omits forbidden transitions, a use case lacks a disallowed-role test, or worlds built ad hoc instead of seed builders. 3: every test calls
`as(actor).<useCase>` on fresh PGlite with real migrations, fake clock, in-memory fakes only at ports, seed builders; full transition table; allow+deny authz per use
case; S-flag tickets add their Seam 2 journey with `expectRendersAccessibly`. 4: 3 + literal hand-computed expected values; test names read as behaviour; the mutation
probe (§6) turns the suite red for every core line mutated; obsolete shallow tests deleted (replace, don't layer).

**R4 Security and privacy** (always). 0: a use case without `can()` as its first call or with the wrong resource scope (IDOR); a committed secret or `.env*` content;
plaintext column for phone/DOB/address/guardian/PAN; PII in a log or Sentry payload. 1: missing step-up on a listed action (role grant, settings, refund approval, results
approval, 80G, two-approver ops, exports); unverified webhook signature; signed URL issued before `can()`; an original asset publicly reachable. 2: controls present but
>=1 untested path (coordinator of another institution), sign-in errors that enumerate accounts, new dependency without lockfile or `allowBuilds` entry. 3: every
applicable control present and tested; every new PD field in the data inventory with purpose + retention ("default marked to confirm"); audit row for every state
change; zod at every edge; no inline script on public pages (CSP #65). 4: 3 + abuse cases tested and failing safe: cross-scope IDOR, replay, rate-limit bypass
(`A@x.com` vs `a@x.com `), expired-then-reused tokens, registration number tried as a credential.

**R5 Safeguarding of minors** (trigger: K flag, or diff touches guardian, minor, consent, public read models, message routing). 0: minor PII in a public read model or
visible to a role without need; a minor can do an adult-only act (donate #106, bid #132). 1: consent checked on write but not on the read model (withdrawal leaves the
item public); age persisted instead of DOB; school declaration treated as public-use consent (#83). 2: rules enforced, >=1 path untested (13-17 linked login, guardian
routing of messages about a minor, signed form counted before FOA acceptance). 3: every applicable rule enforced at Seam 1 with negative tests; consent record keeps
subject, giver, purpose, version, time, method (+ reviewer for signed forms); public credit = first name + last initial. 4: 3 + age-boundary fixtures under the fake
clock in `Asia/Kolkata` (12y364d, 13y0d, 17y364d, 18y0d at IST vs UTC midnight); skeptic sweep of every public read model, log and confirmation copy found nothing.

**R6 Money correctness** (trigger: $ flag, or diff touches fees, payments, refunds, ledger, donations, receipts, auctions). 0: money as JS `number`/float/`numeric`
instead of paise `bigint` + ISO currency; double posting or receipt-number gap/duplicate possible. 1: invariants hold on the happy path only; replay or refund untested or
failing. 2: invariants tested sequentially; idempotency only in app code (no unique constraint on provider event id); FY boundary untested. 3: every #55 money invariant
tested: 1 capture -> exactly 1 posting + 1 receipt with the next FY number; replayed webhook changes nothing; refund -> reversal; transparency = ledger for published
periods; FCRA-off foreign capture refunded; display via `getFormatter` `inr`. 4: 3 + DB-level guarantees (partial unique index on event id, per-FY sequence under lock)
with a test proving the duplicate is rejected; postings balance to zero; 31 Mar 23:59:59 IST vs 1 Apr 00:00:00 IST receipt fixture.

**R7 Accessibility** (trigger: rendered change under `src/app/**` or `src/components/**`). 0: axe violations, or an axe check skipped or narrowed. 1: a new page in no
Seam 2 spec; unlabelled fields; placeholder as label; div-buttons. 2: axe clean in light only; no error-summary focus, `aria-invalid`, `aria-describedby`,
`autocomplete="one-time-code"`/`inputMode="numeric"` on OTP; targets <44px; meaning by colour alone. 3: every new page in a spec calling `expectRendersAccessibly`, light +
one `.dark` run, 360px without horizontal scroll, form kit and `Callout`/`Chip` patterns used. 4: 3 + skeptic keyboard-only walkthrough passes; Lighthouse mobile a11y
>=90 evidence on public pages; the six states (empty, loading, error, success, permission-denied, pending) reachable with seed data.

**R8 Deep-module design** (always; `codebase-design` vocabulary). 0: UI, server action or route handler touches the DB or holds business rules. 1: shallow modules
(interface about as big as the implementation, Middle Man), a port with one adapter, a rule smeared over several callers (Shotgun Surgery). 2: deep use cases but the
interface leaks ordering or invariants callers must enforce, or internal seams exported only for tests. 3: thin edges (zod parse, resolve actor, call ONE use case); one
module per #55 module row; clock and ports injected; ports only at provider seams with production + fake adapters; tests at the interface. 4: 3 + deletion test passes
for every new module; the "Extended by" tickets can add behaviour without changing the interface.

**R9 Codebase conventions** (always; Standards axis; Fowler smell baseline only as labelled judgement calls). Hard rules: AGENTS.md (read `node_modules/next/dist/docs/`;
`src/proxy.ts`; Cache Components: request data inside `<Suspense>`, clock via `cachedNow()`); code-ui §2-3 (semantic tokens, no wiped palette names, `cn()`,
`buttonStyles`, `Section`/`PageHeader`, `ROUTES`, `pageMetadata`, route-local `_components`); statuses as Postgres enums named after the entity; UUIDv7 ids;
`timestamptz` UTC; `APP_ENV`; no `oxlint-disable` without `-- reason`; no spec/§/milestone citations in code or test titles; PR body per `pr` skill (Summary, Evidence,
Merge Danger). 0: locked-stack breach or a lint rule disabled wholesale. 1: >=3 hard violations. 2: 1-2 hard violations or >=4 unaddressed smells. 3: zero hard
violations, <=2 labelled smells. 4: zero of either; reuses existing primitives (no second `TableScroller`, `Chip`, form field); new shared primitive on `/styleguide`.

**R10 i18n and copy** (trigger: visible strings, `messages/en-IN/**`, email/SMS/in-app templates). 0: literals behind `oxlint-disable`, or templates inlined in code.
1: new namespace not registered in `src/i18n/messages.ts` (fails `messages.test.ts`). 2: `toLocaleString`, manual "₹", times shown in UTC, banned phrase, client island
translating instead of taking a `labels` prop. 3: all copy via next-intl; money/dates via `getFormatter` with `src/i18n/formats.ts`; every new message-sending event has a
template. 4: 3 + kid-facing copy grade <=6 (`happy-copy.test.ts` rules); errors say how to recover; confirmations echo no PII.

**R11 Migration safety** (trigger: `src/server/db/schema/**` or `drizzle/**` changed). 0: edits, renumbers or deletes an applied migration (`0000_enable_pg_trgm` +
whatever `main` held at start); destructive DDL (drop, narrowing, rename) without a data plan. 1: fails on fresh PGlite or local PG 16; journal `when` not strictly
increasing (`jq '[.entries[].when] | . == sort'`). 2: applies, but a new extension is not loaded in `src/test/db.ts`, an FK/lookup column lacks an index, or PG-version-
specific SQL. 3: TS schema is the source; branch SQL is disposable and regenerated by the merge queue (decision 9); hand-written SQL (partial unique indexes, append-only
triggers, trgm, earthdistance) in custom migrations the queue re-appends; enums/ids/timestamps per convention. 4: 3 + invariants enforced by constraints and tested;
Merge Danger says `Door: one-way` for DDL with the forward-fix plan.

**R12 Performance** (trigger: public page, list query, job handler or client island changed). 0: a public page leaves the prerendered set, or `pnpm check:build` fails
(170 KB gz initial JS, iOS 16 syntax). 1: N+1 or unbounded query over rows that grow with participants (per-row query in a 30-row CSV import), unpaginated admin list.
2: correct but a filtered column lacks an index, or a client island bigger than needed. 3: prerender kept (build route table), budget met, bounded indexed queries,
Lighthouse mobile perf >=90 evidence for new public pages. 4: 3 + query-count or `EXPLAIN` evidence on the hot path; no new client JS on public pages.

Worked applicability: #57 (A H S P): R5, R6 n/a; 3 judges. #106 ($ K P): all twelve; 3 judges. #83 (K): R6 n/a; R7 for the code-link page, coordinator dashboard and
admin review screens; R11 for consent-method columns; 3 judges.

## 3. Final review pass rules
| Dim | Min (no flag) | Min (flagged) | Aggregation across 3 judges |
|---|---|---|---|
| R1 R2 R3 R7 R9 R10 R11 | 3 | 3 | median |
| R4 / R5 / R6 | 3 | 3 and no judge <3 (R4 for A/E/C, R5 for K, R6 for $) | minimum, veto needs reproduced evidence |
| R8 | 2 | 3 | median |
| R12 | 2 signed-in / 3 public page | same | median |
- Hard fails (any one = FAIL): skipped/disabled/quarantined test or narrowed axe; red deterministic gate; secret or `.env*` content in the diff; anything pushed to
  `main`; applied migration edited; missing `can()`; float money; minor PII in a public read model; a verified `refuted` AC.
- Judge verdict PASS iff no hard fail, every applicable dimension >= its minimum, and the mean of applicable dimensions >= 3.0 (no flag) or >= 3.25 (flagged). Ticket
  passes iff all deterministic gates are green AND (1 judge: PASS; 3 judges: >=2 PASS AND aggregated scores meet the table) AND every AC is `upheld`, or `unverifiable`
  with a residue child.
- Veto: one judge below a safety minimum blocks only if the Orchestrator reproduces its evidence (`git show <sha>:<path> | sed -n '<l>p'`, or re-runs the cited command).
  Not reproduced => score dropped, a replacement judge scores that dimension. Spread >=2 on any dimension => a tie-break judge scores it from both rationales, unattributed.
- Re-review after the fix loop uses NEW judges and skeptics, cold, without prior verdicts; the Orchestrator separately checks every prior failing item on the new head.
  Each review round counts toward decision 7's caps.
- Record median scores, verdicts and skeptic counts (upheld/refuted/unverifiable) in the status comment and `docs/factory/ledger.json` `reviews[]` (head_sha,
  rubric_version, verdict JSONs, aggregation result).

## 4. Prototype tournament rubric (T1-T8, 3 judges per tournament)
Two kinds (skills-2 §6.9): design tournament = `prototype`-skill entries (logic HTML or `?variant=` UI, no tests), winner folded into a fresh ticket branch under TDD;
implementation tournament = full TDD entries from DESIGN-IT-TWICE angles, winner renamed into the ticket branch. T4 reads "test plan feasibility" for design entries and
"tests present and green" for implementation entries. UI entries are judged from Playwright screenshots at 360 and 1280 px, light and dark, per variant key, from a
local `pnpm build && pnpm start` (`proto/**` gets no Vercel preview).

| ID | Dimension | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|
| T1 | Spec + AC fit | contradicts ticket or #55 | >=2 ACs unreachable by design | all reachable, >=1 awkward | every AC has a clear home | every AC demonstrated in the entry |
| T2 | Interface depth | logic in edges | shallow, pass-through | deep but leaky | small interface, #55 module shape | 3 + "Extended by" tickets fit unchanged |
| T3 | Risk invariants | flagged invariant broken | held by caller discipline only | one choke point, untested | choke point + DB constraint | 3 + abuse cases shown failing safe |
| T4 | Seam 1 testability | needs internal mocks | ACs testable only by DB peeking | most ACs via `as(actor)` | all ACs via `as(actor)` + fakes | tests green, transition table complete |
| T5 | Locality / conflicts | edits other modules' internals | hits >=3 serialize keys | hits 2 | <=1, with reason | confined to its module + messages ns |
| T6 | Simplicity | speculative framework | >2x the code of the leanest entry | extra concepts | lean, nothing speculative | leanest entry with T1-T4 >=3 |
| T7 | Stack + conventions | locked-stack breach | ignores Next 16.4 rules | several R9 violations | R9 clean | R9 clean + reuses existing primitives |
| T8 | UX (UI entries only) | axe/keyboard broken | key states missing | usable, rough at 360 px | clean at both widths and themes | 3 + six states, copy fit for kids |

Serialize keys (T5): one schema module, one route tree, one messages namespace, `src/components/form/**`, `src/components/ui/**`, `globals.css`, `site-header.tsx`,
`src/lib/routes.ts`, `src/i18n/messages.ts`, Seam 1 harness files (`src/test/**`).
- Eligibility: T1 >=2, T4 >=2, T3 >=2 (>=3 when risk-flagged), no locked-stack breach. Ineligible entries cannot win but may donate grafts.
- Winner: each judge compares every pair twice (A/B, then B/A); a preference counts only if the same entry wins both orders, else tie. Copeland score over 3 judges;
  ties -> weighted T-sum (T1 x2, T3 x2 if flagged, others x1) -> fewer added lines. The Orchestrator computes this, not a judge.
- Grafts: judges name <=3 ideas from runners-up (idea, `proto-archive/<issue>-<x>:path:line`, dimension raised, cost); a graft lowering T5 or T6 is dropped. No eligible
  entry, or best T1 <3: one revision round, then single implementation carrying the judges' notes.

## 5. Judge prompt templates (Workflow `agent()` with `schema`, `isolation:'worktree'`, spawned by the Orchestrator)
Facts pack written by the Orchestrator before spawning (judges never see runner transcripts, PR prose or self-review): ticket body; #55 excerpts (module row, rulings,
Testing Decisions); `git diff --stat` and diff vs merge-base with trailers stripped; output of `pnpm check`, `pnpm build` (route table), `pnpm check:build`; Vitest test
names; CI/E2E statuses; grep flags (`\.skip|\.only|fixme`, `vi\.mock\(`, `oxlint-disable`, `toLocaleString`, `VERCEL_ENV`,
`(gray|slate|zinc|stone|indigo|emerald|amber|rose|sky|violet)-[0-9]`). Lenses for 3 judges: J1 Spec (R1 R2 R3 first), J2 Risk (R4 R5 R6 R11 first), J3 Craft (R7 R8
R9 R10 R12 first); every judge scores all applicable dimensions; 1-judge tickets get the generalist lens.
```text
You are judge {{judge_id}} ({{lens}}) for ticket #{{n}} of friends-of-animals at {{head_sha}}, worktree {{worktree}}.
You did not write this code. Judge it cold against rubric {{rubric_version}} in {{rubric_path}}.
Read first: {{ticket_path}}, {{spec_excerpt_path}}, {{facts_path}}. Then read the changed files in full, not only the diff.
1. AC map: for every "- [ ]" line, name the test (file:line) that goes red if the AC is violated, or the residue issue;
   status covered|weak|missing|residue.
2. For R1..R12: decide applicability by the rubric trigger (quote the check). Gather evidence by reading code and running
   read-only commands (pnpm test <file>, pnpm typecheck, pnpm lint, git, grep). Write evidence, then rationale, then score.
   Thin evidence = 2. A 3 needs one cited item, a 4 two independent items. Answer "why not one higher" below 4.
3. List every hard fail with evidence. Apply the pass rules in rubric section 3 to your own scores for the verdict.
Size, comments, commit messages and confident prose are not evidence. Never edit, commit, push or post to GitHub.
Done when the JSON validates, every applicable dimension has evidence, and every AC appears in ac_map.
```
Verdict schema (the `schema` option; the tie-break judge returns the same shape with one dimension):
```json
{"type":"object","required":["ticket","head_sha","judge_id","rubric_version","ac_map","scores","hard_fails","verdict","top_fixes"],"properties":{
 "ticket":{"type":"integer"},"head_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"judge_id":{"type":"string"},"rubric_version":{"type":"string"},
 "ac_map":{"type":"array","items":{"type":"object","required":["ac","status","tests"],"properties":{"ac":{"type":"string"},
   "status":{"enum":["covered","weak","missing","residue"]},"tests":{"type":"array","items":{"type":"string"}}}}},
 "scores":{"type":"array","items":{"type":"object","required":["dim","applicable","evidence","rationale","score"],"properties":{
   "dim":{"enum":["R1","R2","R3","R4","R5","R6","R7","R8","R9","R10","R11","R12"]},"applicable":{"type":"boolean"},
   "evidence":{"type":"array","items":{"type":"string"}},"rationale":{"type":"string","maxLength":800},"score":{"type":["integer","null"],"minimum":0,"maximum":4}}}},
 "hard_fails":{"type":"array","items":{"type":"object","required":["code","evidence"],"properties":{"code":{"type":"string"},"evidence":{"type":"string"}}}},
 "verdict":{"enum":["PASS","FAIL"]},
 "top_fixes":{"type":"array","maxItems":5,"items":{"type":"object","required":["dim","where","fix"],"properties":{"dim":{"type":"string"},"where":{"type":"string"},"fix":{"type":"string"}}}}}}
```
Tournament judge: same frame and rules; inputs are entries renamed `Entry 1..k` (branch names, angle names, commit messages and trailers stripped; order rotated by
judge index, because scripts cannot call `Math.random`); output `{ticket, judge_id, entries:[{entry, scores:{T1..T8}, eligible, notes}], pairwise:[{order:"1v2"|"2v1",
prefer:"1"|"2"|"tie", reason}], grafts:[{from, idea, where, raises, cost}]}`.

## 6. Adversarial skeptic template (one per AC)
Schema: `{ac_index, ac, verdict:"upheld"|"refuted"|"unverifiable", attacks:[{kind, command, result}], evidence, residue_needed}`.
```text
You are the skeptic for AC {{k}} of ticket #{{n}} at {{head_sha}}: "{{ac_text}}". Refute it: show with a reproducible command
that some real actor can hit a case where the code does not meet this AC. Run at least 3 distinct attacks from:
boundaries (fake clock at expiry -1s/+1s; 31 Mar 23:59:59 IST; ages 12y364d, 13y0d, 17y364d, 18y0d); wrong actor or scope
(disallowed role, other institution's coordinator, another minor's guardian, signed out); replay or reuse (same webhook, OTP
or code link twice); order (refund before capture, two captures); leakage (public read models, logs, error and confirmation
copy); test bite (mutation probe: change one implementation line in your scratch worktree, run the AC's test; green = no bite).
Write probe tests only in your scratch worktree; never commit or push. Evidence = command + output excerpt.
Verdict: refuted (reproduced failure), upheld (list every failed attack), unverifiable (needs a provider account or a human;
name it). Done when the JSON validates and every attack has a command and a result.
```
Orchestrator handling: `refuted` -> re-run the evidence command; reproduced -> fix loop; not reproduced -> one fresh skeptic; still split -> treat as refuted.
`unverifiable` -> residue child `ready-for-human` + `factory:needs-human` (decision 8).

## 7. LLM-judge failure modes and mitigations
| Failure | Mitigation |
|---|---|
| Position bias | Both orders per pair; a preference counts only if order-consistent; entry order rotated per judge |
| Verbosity / length bias | T6 rewards less code; prose, comments and PR claims are not evidence; diff stat in the facts pack; "size is not merit" in the prompt |
| Self-preference (Opus 5.5 only, no model diversity) | Fresh-context judges spawned by the Orchestrator, never the runner; entries anonymised; `Claude-Session`/`Co-Authored-By` trailers and agent labels stripped; three lenses; evidence-gated scores |
| Leniency / sycophancy | Default 2; a 4 needs two evidence items; "why not higher" and >=1 top fix required; deterministic gates and skeptics override |
| Anchoring on claims | No PR body, self-review or runner transcript; judges run commands themselves |
| Fabricated evidence | Orchestrator spot-checks 2 cited `path:line`s per verdict (all, for vetoes); one fabrication voids the verdict and the judge is re-spawned |
| Harsh outlier | Safety vetoes need reproduced evidence; spread >=2 -> tie-break judge |
| Re-review anchoring | Fix-loop re-judges are fresh and never see prior verdicts |
| Drift across waves | `rubric_version` in every verdict; edits only at milestone retro (tightenings applied, loosenings -> `ready-for-human`); calibration set re-scored after each edit |
| Large-diff overload | Judges read changed files by module; XL tickets judged per module plus one cross-module judge |

## 8. Calibration on the first 3 reviewed tickets (#57, then the next two to reach review, read from the ledger)
1. Before #57's review, every judge scores two reference commits: `2b92b98` (#29 / PR #53: evidence-backed deviation, clean) and `e58a346` (#32 / PR #54: pushed
   without re-running checks, broke every Vercel build). Each judge must rank #53 above #54 on R9 and R12.
2. Seed 3 defect variants of the #57 head on local-only `calib/57-{a,b,c}` branches (never pushed): (a) delete one `can()` call, (b) turn one deny authz test into
   allow-only, (c) hard-code a visible string behind `oxlint-disable`. Every judge must flag >=2 of 3 (expected: R4 hard fail; R3 <=2 + R2 weak; R10 <=1), and the
   skeptic on each affected AC must return `refuted`.
3. Run all 3 tickets with 3 judges regardless of flags. Targets: >=80% of applicable dimensions within +-1 across judges; PASS/FAIL unanimous on >=2 of 3 tickets; zero
   unreproducible vetoes. Miss -> quote the disputed case into the offending anchor, bump to r2, re-score the calibration set.
4. Ground truth after merge: a PASS later contradicted by CI, E2E or a later skeptic on a dimension scored >=3 is a leniency incident in `ledger.json`
   `calibration.incidents[]`; 2 incidents on one dimension -> raise its minimum by 1 until the milestone retro. Freeze the rubric after ticket 3 and post per-dimension
   agreement on the dashboard issue.
