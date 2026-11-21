# Brief 134: feedback surveys (#134, M8)

Branch `ticket/134-feedback-surveys` · worktree `/root/foa-wt/134` · cut from `foa/M0` 442dd99 (rebase onto `foa/M8` at build) · size L · risk (PD, K minors via guardians, A unauthenticated token endpoint) · no conflict key · blockers **114** (inventory + retention registry) and **117b** (CSV writer `src/server/lib/csv.ts`, H45). Also needs on trunk: 59a, 60, 61a, 64, 69, 74, 75b, 78, 81a, 81b, 82, 99a, and 74's `src/server/tokens/link-token.ts`. Soft: #126's `Audience` module (reuse its recipient resolution if it landed first). No siblings: unit 134 is the whole issue.
**Head start on the branch:** `9741daa M8 #134: Add feedback survey domain core` (pushed, no PR; 6 files, 50 tests): the pure survey core in `src/server/modules/surveys/domain/` (see Files). It touches no shared file; rebase onto `foa/M8` at build.

## Scope
**In:** `survey`, `survey_question`, `survey_invitation`, `survey_response`, `survey_answer` + enums `survey_status`, `survey_question_kind` (all values up front, F2); a competition manager builds a survey for a competition, sends it after results publish (`openSurvey` = send), closes it; invitations to consented participants, guardians of minors and coordinators, deduped per person; answer once by token link (`/surveys/[token]`, no sign-in) or from the dashboard; aggregated results; CSV export (step-up, audited); seed; inventory rows + two retention policies; 69 route + `survey_invitation` template (email + in_app); 7 pages.
**Out:** reminders to non-respondents (not asked); SMS (route is email + in-app, no DLT, G2 untouched); small-count suppression on results (not asked; `docs` note only); the objective feedback report (#135c reads `getSurveyResults`); reopening a closed survey; surveys not tied to a competition.

## Acceptance criteria as testable checks (all Seam 1 unless marked)
1. **Recipients.** World: adult participant A (messages consent given), adult B (no consent), minor C with verified guardian G1 (consented), minors D and E with the same guardian G2 (consented), minor F with guardian G3 (no consent), school-route minor H with no guardian account, teen T with own login whose guardian is G1, coordinator K of an institution with a confirmed registration (consented), coordinator L of an institution not in this competition, cancelled registration M (consented), unrelated member N. `openSurvey` with all three audiences → invitations exactly `{A: participant, G1: guardian, G2: guardian, K: coordinator}`, result `{ invited: 4, skipped: { noConsent: 2, noGuardian: 1, noAccount: 0 } }`. Turning an audience flag off drops its people. T is never invited directly. After `h.drain()`: one email per invitee holding a `/surveys/<43-char token>` link and one in-app item linking `/dashboard/surveys/<surveyId>`; N, L, M, B, G3, T get nothing. Pure: `planInvitations` table (done).
2. **Once per person.** Token submit then token submit → `already_responded`; token then dashboard → `already_responded`; dashboard then token → `already_responded`; G2 (two children) answers once. Exactly one `survey_response` row. Enforced by `UPDATE survey_invitation SET responded_at … WHERE responded_at IS NULL RETURNING` in the insert's transaction (+ unique `(survey_id, recipient_user_id)`).
3. **Window and bad tokens.** Token after `closeSurvey`, or after `closes_at` (clock advance) → `survey_closed`; draft survey → `not_found`; unknown, malformed (`isWellFormedLinkToken`) or another survey's token → the same `not_found` shape. `getSurveyByToken` returns title, competition title, questions, closes date and nothing about the person. Pure: `decideAnswer` (done).
4. **Anonymity by default.** Anonymous survey: `survey_response.respondent_user_id` null, id is UUIDv4 (version nibble `4`), `submitted_on` is a `date` (IST), no column joins a response to an invitation, `token_ciphertext` nulled on response. Identified survey (`identified = true`, shown on the survey page): `respondent_user_id` set.
5. **Answer validation.** Required unanswered, rating outside 1–5 or non-integer, option not offered, duplicate multiple-choice options, free text over 2000 chars, an answer to a `prompt`, an unknown question id → `invalid_answers` with question ids; nothing written. Pure (done).
6. **Results match a hand-computed fixture.** Pure fixture (done): per rating question answered count, distribution 1..5, mean to 2 dp; per choice question counts per option and percent of that question's respondents to 1 dp; free text count; response rate. S1: seed the same 7 responses through `submitSurveyResponse` → `getSurveyResults` deep-equals the pure fixture (+ free-text answers listed for the manager, newest-agnostic order).
7. **Export without personal data unless the survey says so.** Anonymous survey CSV: columns `submitted on` + one per answerable question; free-text columns only when `include_free_text_in_export`; no name, email, user id, response id, token or invitation data; rows sorted by response id (random). Identified: + respondent name, email, role. Pure table (done); S1 through 117b's writer: BOM, CRLF, a free-text answer starting `=` neutralised; one `audit_log` row `survey.exported` with `{ rows, identified, freeText }` only; no step-up → `step_up_required`, nothing written.
8. **Lifecycle.** `openSurvey` before results publish (99a `publishedRelease` null) → `results_not_published`; with no answerable question → `no_questions`; `closes_at` not after now or over 90 days → `invalid_closes_at`; `editSurveyQuestions` on an open survey → `not_draft`; `closeSurvey` twice → `{ changed: false }`; closed is terminal. Pure: `decideOpen`/`decideClose`/`decideEdit` (done).
9. **Authorization, every new use case.** Builder, open, close, results, export: competition_manager global or scoped to that competition passes (staff second factor per #60); competition_manager scoped to competition B refused for A; institution coordinator refused export; member refused results; visitor refused. Dashboard reads and submit: the invited user passes; another user gets `not_found`; visitor `forbidden`. Token reads and submit: bearer (visitor or any user) with a valid token. Refusals write nothing.
10. **Inventory** (Vitest over the real barrel, 114's coverage test). PD entries: `survey.created_by_user_id`, `survey_invitation.{recipient_user_id, token_hash, token_ciphertext, role, sent_at, responded_at}`, `survey_response.respondent_user_id`, `survey_answer.value` (free text may hold PD); the rest on `NON_PERSONAL`. Policies `surveyInvitations` (delete 365 d after survey close) and `surveyIdentities` (anonymise: null `respondent_user_id` and free-text values 365 d after close), "confirm with counsel".
11. **Seed** (S1): a results-published seeded competition with one open anonymous survey (3 invitations, 2 responses, one preview-only fixed token `SEED_SURVEY_TOKEN`), one draft; idempotent.
12. **Pages** (Seam 2, written, **Not run**): `tests/e2e/134-feedback-surveys.spec.ts` answers the seeded survey via `/surveys/[token]`; `expectRendersAccessibly` light + dark on `/surveys/[token]` (form and thank-you), `/dashboard/surveys`, `/dashboard/surveys/[surveyId]`, `/admin/competitions/[competitionId]/surveys`, `/admin/surveys/[surveyId]`, `/admin/surveys/[surveyId]/results`.

## Files
- **Have (head start):** `src/server/modules/surveys/domain/{questions,answers,results,export-table,lifecycle,invitation-plan}.ts` + tests.
- **New:** `src/server/db/schema/surveys.ts`; generated migration `134_feedback_surveys` (no custom SQL); `src/server/modules/surveys/{index,policy,recipients,build,open,answer,results,export,dashboard,events,notifications,inventory}.ts` + Seam 1 tests; `src/server/seed/surveys.ts`; `src/app/surveys/[token]/{page.tsx,actions.ts,_components/*}`; `src/app/dashboard/surveys/**`; `src/app/admin/competitions/[competitionId]/surveys/**`; `src/app/admin/surveys/[surveyId]/{page.tsx,actions.ts,results/page.tsx,export/route.ts}`; `messages/en-IN/surveys.json`; `tests/e2e/134-feedback-surveys.spec.ts`.
- **Hotspots (append one line/entry each):** schema barrel (H1), `seed/index.ts` (after 99a's seeder, H6), `src/server/app.ts` (`surveysUseCases`), 59a policy table (H8, 10 actions), 60 step-up flag on `surveys.export`, 61a event union/handler registry (H9), 69 route + template seed and audience/context-loader registries (H9), 114 inventory + retention policies (H5/H41), `src/i18n/messages.ts` (H3), `src/lib/app-routes.ts`, admin + dashboard nav (H19), `drizzle/meta/*` (merge queue). Read-only: 117b `csv.ts`, 74 `link-token.ts`.
- **Next traps:** `/surveys/[token]` renders under `<Suspense>` after `await connection()`, `robots: { index: false }`, never echoes PD; the export is a GET route handler with `await connection()`, `Cache-Control: no-store`, `Content-Disposition: attachment`; Server Actions: authenticate → zod → one use case (first line `authorize`). Check 65's CSP matcher covers the dynamic token page.

## Design (codebase-design; three designs compared for once-only + anonymity)
- **(A) Invitation ledger (chosen).** The invitation row knows *that* a person answered (`responded_at`); the response row doesn't know *who* (UUIDv4 id, date only, no FK to the invitation). One transaction: conditional update on the invitation, then insert response + answers. No secret, no new key; "once" is a DB fact. Residual: physical row order could correlate for a DB superuser; the app never exposes order and exports sort by random id (documented).
- **(B) Per-survey HMAC respondent key.** Once-only via `HMAC(userId, salt)` on the response. A salt stored in the DB lets anyone with read access re-link every response; a secret salt is a new production secret, which spec 0.4 avoids. Rejected.
- **(C) Always store the user id, hide it in reads/exports.** Shallowest, but anonymity rests on every read path being right forever, and identified/anonymous differ only in a filter. Rejected.
- **Module shape.** One deep `surveys` module: 11 use cases over pure rules (validation, aggregation, export table, lifecycle, invitation plan). `recipients.ts` is the only file that reads other modules (registrations, profiles, guardians, consents, coordinators) and turns them into `InvitationCandidate[]` for the pure planner; #126's `Audience` replaces its body if it landed.
- **Invitations at send time.** (1) **Chosen:** created inside `openSurvey`'s transaction (atomic, consent read at one instant, the manager sees the count at once), one outbox `survey.invited` (ids only) per invitation, delivery async through 69. (2) A `survey.opened` subscriber that expands later: more moving parts and no count to show. `survey.opened` is still emitted (ids only) for #119/#135 consumers.
- **Tokens.** 74's `createLinkToken` (32 bytes, base64url) → `token_hash` (unique, lookup) + `token_ciphertext` (#58 `encryptedText`) so 69's context loader builds the link at send time; outbox payloads hold ids only; ciphertext nulled on response and on close.
- **Defaults (reversible, in the PR):** participants = `confirmed` registrations; minor = under 18 on the IST date of `openSurvey` (78's `ageAt`), invited never, their active verified guardians invited instead; consent = the recipient's own #64 `messages` consent (guardians included; the child's #82 `communications` consent is about contacting the child, who isn't contacted); coordinators = `institution_coordinator` of institutions with ≥ 1 confirmed registration; one invitation per person, role precedence participant > guardian > coordinator; `closes_at` default open + 14 days, max 90; ≤ 20 questions, 2–10 options, texts ≤ 300 / options ≤ 120 / free text ≤ 2000 chars; mean rounded half away from zero to 2 dp, percent to 1 dp; 69's resolver re-checks messages consent at send (withdrawn → no message, invitation stays answerable from the dashboard).

## Interface needs (code against these; rename to what lands)
```ts
// 57a: createHarness(), h.as, h.clock, h.drain?; UseCaseContext = Deps & { actor }; uuidv7(at)
// 59a
authorize(ctx, action: `surveys.${"build" | "open" | "close" | "results" | "export"}`, resource: { scopes: Scope[] }): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
recordAudit(tx, ctx, { action: "survey.created" | "survey.opened" | "survey.closed" | "survey.exported"; entity: { type: "survey"; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
h.seed.grant(user, { role: "competition_manager", scope: { type: "competition", id } }); h.seed.superAdmin()
// 60: policy flag secondFactor: "step-up" on "surveys.export"; error "step_up_required"; h.stepUp(actor)
// 61a
emit(tx, clock, e: { type: "survey.opened" | "survey.invited" | "survey.responded"; aggregate: { type: "survey" | "survey_invitation"; id: string }; payload: { surveyId: string; invitationId?: string } }): Promise<void>;
// 64 / 69
hasMessagesConsent(db: AppDb, userId: string): Promise<boolean>;
registerAudience("survey_invitee", (db, { aggregateId }) => Promise<{ userId: string }[]>); // invitation's user, re-checking consent
registerContextLoader("survey.invited", (db, event) => Promise<{ surveyTitle: string; competitionTitle: string; surveyUrl: string; dashboardUrl: string; closesOn: string }>);
// 58: encryptedText column type; decryptText(ciphertext): string
// 74: createLinkToken(): { token; tokenHash }; hashLinkToken(token); isWellFormedLinkToken(value)
// 75b / 78
registration: { id; participantProfileId; competitionId; status: RegistrationStatus /* "confirmed" used */; institutionId: string | null };
participantProfile: { id; ownerKind: "institution" | "self" | "guardian"; ownerUserId: string | null; loginUserId: string | null; dob: CalendarDate };
ageAt(dateOfBirth: CalendarDate, at: Date): number;
// 81a / 81b
activeGuardiansOf(db: AppDb, profileId: string): Promise<{ guardianId: string; userId: string; verified: boolean }[]>;
// 74
usersWithRole(db: AppDb, role: "institution_coordinator", scope: { type: "institution"; id: string }): Promise<{ userId: string; name: string }[]>;
// 99a
publishedRelease(db: AppDb, competitionId: string): Promise<{ id: string; publishedAt: Date } | null>;
// 70a: competition { id; title; slug }
// 117b (H45)
toCsv(rows: readonly (readonly (string | number | null)[])[]): string; // RFC 4180, BOM, CRLF, neutralises = + - @ tab CR text cells
// 114 (H41/H5)
INVENTORY.push({ table, column, category, purpose, subject, retention: { policy, period, basis, toConfirm: true }, onExpiry });
registerRetentionPolicy({ key: "surveyInvitations" | "surveyIdentities", action: "delete" | "anonymise", defaultDays: 365, candidates, apply });
```

## Residue
- **HR-31 / G1:** retention of survey invitations, identities and free text (365 d after close) "confirm with counsel"; appended to 114's G1 child.
- **HR-66** (M8 defaults, append): audiences, minor cutoff, role precedence, `closes_at` default/max, question limits; anonymity statement copy on the survey page and invitation email (G3 copy batch).
- **HR-27/HR-28:** Seam 2 and axe on previews (no Postgres server here; previews fail at `pnpm db:migrate`). Not run.

## Test plan
- **Pure (done):** `questions.test.ts`, `answers.test.ts`, `results.test.ts` (hand-computed fixture), `export-table.test.ts`, `lifecycle.test.ts`, `invitation-plan.test.ts`.
- **Seam 1** (`createHarness()`, PGlite real migrations, `FakeClock`, email fake, `h.drain()`): `build.test.ts`, `open.test.ts`, `answer.test.ts`, `results.test.ts`, `export.test.ts`, `dashboard.test.ts`, `src/server/seed/surveys.test.ts`; 114's `inventory.test.ts` stays green.
- **Seam 2 (Not run):** `tests/e2e/134-feedback-surveys.spec.ts`.

## Slices
1. **Build a survey** (AC 5 pure-wired, 8 edit/draft, 9 build): schema + migration + enums, `createSurvey`, `editSurveyQuestions`, policy actions. Test `src/server/modules/surveys/build.test.ts`.
2. **Send after results publish** (AC 1, 8 open/close, 9 open/close): `recipients.ts`, `openSurvey`, `closeSurvey`, tokens, outbox events, 69 route/template/audience/loader. Test `open.test.ts`.
3. **Answer once, anonymously** (AC 2, 3, 4, 5, 9 token/dashboard): `getSurveyByToken`, `submitSurveyResponse` (token or signed-in), `listMySurveys`, `getMySurvey`. Test `answer.test.ts` + `dashboard.test.ts`.
4. **Results and export** (AC 6, 7, 9 results/export): `getSurveyResults`, `exportSurveyResults` via 117b's writer, step-up, audit; inventory rows + retention policies (AC 10). Test `results.test.ts` + `export.test.ts`.
5. **Pages, seed, Seam 2** (AC 11, 12): seven pages, `surveys` namespace, nav links, seed. Test `src/server/seed/surveys.test.ts` + `tests/e2e/134-feedback-surveys.spec.ts`.
