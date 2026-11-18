## 7. Judging, Results, Certificates, Gallery & Logo Stamping

**Owns:** rubrics, school-level and FOA-level judging rounds, score storage and aggregation, results approval and publishing, certificates, prize fulfilment, `StampService`, the gallery and the social export queue. This section owns the §3.5 enums `JudgingLevel`, `AwardScheme`, `EntryOutcome` and `CertificateType`. All other enums, the core entities (§3.4) and the code formats (§3.1) are used verbatim.

**Assumed §6 names (map 1:1 if §6 differs):** `Registration` (`participantId`, `institutionRegistrationId?`, categories via `RegistrationCategory`, confirmed status); `InstitutionRegistration`; `Entry` (`registrationId`, `participantId`, `categoryId`, `discipline`, plus EXIF-stripped `WEB` media and a video poster); `PhysicalArtwork`; the competition category (discipline × age group, called `categoryId` here); and the competition flags `allowPublicDisplay` and `digitalSubmissionScope`. §7 calls §6's `EntryService.applySchoolShortlist` to run `SUBMITTED → SCHOOL_SHORTLISTED | NOT_SHORTLISTED`, and `EntryService.revertSchoolShortlist` for its reversal when a school round is reopened. §7 defines the guards for `FOA_JUDGING → RESULTS_PENDING_APPROVAL → RESULTS_PUBLISHED` and requests those transitions through §6's `CompetitionService.transition()`.

**Role abbreviations:** CM = COMPETITION_MANAGER (global or scoped to the competition), SA = STAFF_ADMIN (SUPER_ADMIN implies SA), IA/IC = INSTITUTION_ADMIN / INSTITUTION_COORDINATOR (own institution), J = JUDGE (own assignment), CT = CONTENT_MANAGER, P/G = PARTICIPANT / GUARDIAN (own or linked profile). Every action follows §0: permission → transition guard → AuditLog → Outbox event. Event names use the camelCase entity names that §10 already consumes. **Public identity** (name form, school, city) always follows §12.7 `ParticipantDisplayPrefs`. §7 toggles can only hide more.

### 7.1 Judging Framework (Rubrics)

```prisma
enum RubricStatus { DRAFT PUBLISHED ARCHIVED }
model JudgingRubric {
  id String @id;  competitionId String;  discipline Discipline? /* null = competition default */;  version Int
  status RubricStatus @default(DRAFT);  title String;  guidanceHtml String  // sanitized: how to judge, panel + COI guidance
  frameworkPdfAssetId String?;  publishedAt DateTime?;  publishedByUserId String?
  @@unique([competitionId, discipline, version])
}
model RubricCriterion {
  id String @id;  rubricId String;  order Int;  key String /* unique per rubric */;  label String
  description String                       // what earns high vs low marks
  weight Decimal @db.Decimal(5,2)          // > 0, relative
  maxScore Int @default(10)                // 1–100; judges enter integers 0..maxScore
}
```

- **Rubric resolution:** an entry is scored on the PUBLISHED rubric for `(competitionId, entry.discipline)`, falling back to `(competitionId, null)`. Opening any round, school or FOA, requires a rubric to resolve for every discipline in the competition. Each pair has at most one PUBLISHED rubric, and publishing a new version ARCHIVES the old one. A version referenced by any round past DRAFT is immutable; rounds pin it in `RoundEntry.rubricId`.
- **Validation:** 2–10 criteria, every weight > 0.
- **Seeded default:** Theme & message (30), Creativity & originality (25), Technique (25; the label varies by discipline: "Language & structure" for ESSAY, "Composition & light" for PHOTOGRAPHY, "Storytelling & editing" for VIDEOGRAPHY), Presentation & effort (20), each scored out of 10.
- **Weighted total:** computed on the server only, on a 0–100 scale to 2 decimals: `weightedTotal = 100 × Σᵢ(wᵢ × sᵢ / maxᵢ) / Σᵢ wᵢ`.
- **Standardized judging framework:** on publish, job `rubric.render_pdf` uses Playwright to build a PDF with the criteria per discipline, the `SchoolJudgingPolicy` (§7.3), panel and COI guidance, and the certification text. The same content renders in `/institution/competitions/[code]/judging` and `/judge/rounds/[roundId]/framework`. The PDF is served without authentication (it contains no PII) by `/competitions/[slug]/judging-framework.pdf` and is rebuilt when the rubric or policy changes.

### 7.2 Rounds: Model & Configuration

```prisma
enum JudgingMode { DIGITAL PHYSICAL }            enum RoundEntryPool { FOA_VERIFIED PREVIOUS_ROUND_ADVANCED }
enum PartitionBy { NONE CITY STATE COUNTRY }     enum AssignmentMode { ALL BALANCED }
enum NormalizationMode { NONE Z_SCORE }          enum JudgingRoundStatus { DRAFT OPEN SCORING_CLOSED LOCKED FINALIZED CANCELLED }
model JudgingRound {
  id String @id;  competitionId String;  level JudgingLevel;  name String   // "All India Final"
  sequence Int                                   // SCHOOL = 0; FOA rounds 1..n with non-decreasing level
  status JudgingRoundStatus @default(DRAFT)
  // SCHOOL only
  institutionRegistrationId String? @unique      // required iff level = SCHOOL
  certifiedByUserId String?;  certifiedAt DateTime?;  certificationTextHash String?;  shortfallReason String?
  closedOnBehalfMode String? /* PARTICIPATION_ONLY | STAFF_ENTERED */
  // FOA only
  mode JudgingMode @default(DIGITAL);  requiresPhysicalVerified Boolean @default(true)
  entryPool RoundEntryPool?;  routeFilter ParticipationRoute[] /* default both */;  sourceRoundIds String[]
  partitionBy PartitionBy @default(NONE);  isFinal Boolean @default(false)   // exactly one final round per competition
  advanceCount Int?                              // per (category, partition); null iff isFinal
  awardScheme AwardScheme?;  awardBands Json @default("[]")   // AwardBand[]; [] = no awards this round
  minJudgesPerEntry Int @default(3);  assignmentMode AssignmentMode @default(ALL)
  normalization NormalizationMode @default(NONE);  tieBreak Json /* TieBreakStep[], §7.4.5 */;  shareFeedback Boolean @default(false)
  opensAt DateTime?;  closesAt DateTime?;  resultsHash String? /* set at LOCK */
  openedAt DateTime?;  closedAt DateTime?;  lockedAt DateTime?;  finalizedAt DateTime?;  finalizedByUserId String?
}
enum RoundEntryStatus { ACTIVE EXCLUDED WITHDRAWN DISQUALIFIED }
model RoundEntry {
  id String @id;  roundId String;  entryId String;  categoryId String;  partitionKey String?
  rubricId String /* pinned at open */;  blindTitle String? /* redacts an identifying title */
  status RoundEntryStatus @default(ACTIVE);  excludedReason String?;  submittedSheetCount Int @default(0)
  meanScore Decimal?;  normalizedScore Decimal?;  finalScore Decimal? /* normalizedScore ?? meanScore; all Decimal(5,2) */
  rank Int? /* within (categoryId, partitionKey); may be shared */;  insufficientScores Boolean @default(false)
  advanced Boolean @default(false);  awardBandKey String?;  awardLabel String?;  specialMention Boolean @default(false)
  overrideReason String?;  galleryRecommendations Int @default(0);  auctionRecommendations Int @default(0)
  @@unique([roundId, entryId])
}
```

```ts
type AwardBand = { key: string; label: string /* "All India 1st" | "A Grade" | "Gold" */;
  outcome: 'WINNER' | 'RUNNER_UP' | 'SPECIAL_MENTION';
  rankFrom?: number; rankTo?: number;         // RANKED, MEDAL (inclusive)
  minPercent?: number;                        // GRADED: finalScore ≥ minPercent, evaluated top-down
  prizeId?: string /* → §6 CompetitionPrize; drives PrizeFulfilment (§7.8) */ };
type TieBreakStep = { kind: 'CRITERION_MEAN_BY_WEIGHT' | 'MEDIAN_TOTAL' | 'MANUAL' };
```

- **Default bands** (editable): RANKED is 1st (WINNER, rank 1), 2nd (RUNNER_UP, 2), 3rd (RUNNER_UP, 3). MEDAL is Gold, Silver and Bronze over the same ranks. GRADED is A Grade (WINNER, ≥ 80) and B Grade (RUNNER_UP, ≥ 65). Overlapping bands are rejected on save.
- **Default plan** (seeded with the competition): one FOA round with `NATIONAL`, `isFinal`, `PHYSICAL`, `entryPool FOA_VERIFIED` and §6 `Competition.awardScheme` (the default for the final round; the round may override it).
  - **Adding levels:** each extra level is a round with `entryPool PREVIOUS_ROUND_ADVANCED`.
  - **Partitions:** CITY (City/District) partitions by CITY, STATE by STATE, NATIONAL by COUNTRY or NONE, GLOBAL by NONE.
  - **Partition key:** the trimmed, lowercased `ParticipantProfile.city/state/country`. Judges never see it.
- **Pool guard:** an entry joins a round only if both checks pass.
  - **Consent:** `ConsentService.has(participantId, PARTICIPATION, competitionId)` (§12 gate for judging).
  - **Physical:** `PHYSICAL` forces `requiresPhysicalVerified`. A round with `requiresPhysicalVerified` admits an entry iff §6 `ArtworkService.physicalReady(entryId)`.
  - Entries that fail stay FOA_VERIFIED and appear under "Blocked" on the Pool tab, with the reason.

### 7.3 School-Level Judging (Phase 6)

```prisma
model SchoolJudgingPolicy {                      // one per competition with the INSTITUTION route
  competitionId String @id;  positionsPerCategory Int @default(3) /* 3 or 5 */
  positionLabels String[] @default(["1st","2nd","3rd"])  // N and the window are §6 Competition.schoolShortlistSize / shortlistSubmissionClosesAt
  rubricScoresRequired Boolean @default(false);  minPanelSize Int @default(1) /* UI recommends 3 */
  certificationText String /* versioned; hash stored on the round */
}
model SchoolPanelMember { id String @id; roundId String; name String; designation String; isExternal Boolean @default(false) } // no account
model SchoolResult {
  id String @id;  roundId String;  registrationId String;  categoryId String
  entryId String?                                // null under SHORTLIST_ONLY or when nothing was submitted
  participated Boolean                           // default: SUBMITTED entry exists (ALL) / true (SHORTLIST_ONLY)
  position Int?                                  // 1..positionsPerCategory, unique per (roundId, categoryId)
  advanced Boolean @default(false);  scores Json? /* {criterionKey:int} */;  weightedTotal Decimal? @db.Decimal(5,2)
  @@unique([roundId, registrationId, categoryId])
}
```

1. **Creation:** when a §6 InstitutionRegistration becomes ACTIVE, a SCHOOL round (DRAFT) is created for it. It opens when the competition enters SCHOOL_JUDGING (at `submissionClosesAt`), in both scopes. On opening, one `SchoolResult` row is created per confirmed Registration and category, and rows are re-synced while the round is OPEN.
2. **Coordinator UI** (`/institution/competitions/[code]/judging`): the framework (rubric and PDF), a panel editor and a results grid per category. School rounds are not blind: rows show name, registration number and a thumbnail via signed URL. Columns are participated, position, advance and optional rubric scores. The grid autosaves through `saveSchoolResults`.
3. **`finalizeSchoolRound` validations** (errors reported per row):
   - V1: the panel has at least `minPanelSize` members.
   - V2: the certification box is ticked ("conducted and judged according to FOA guidelines"). Stores `certifiedByUserId`, `certifiedAt` and `certificationTextHash`.
   - V3: positions are unique within 1..`positionsPerCategory` and belong to participated rows.
   - V4: at most N (§6 `schoolShortlistSize`) advanced rows per category. If fewer than min(N, participated count), `shortfallReason` is required.
   - V5: if `positionsPerCategory ≤ N`, every positioned row is advanced.
   - V6: under ALL, every advanced row has a SUBMITTED entry. Under SHORTLIST_ONLY, no entry is needed.
   - V7: if `rubricScoresRequired`, every advanced row has all scores in range.
4. **Finalize effects** (one transaction, plus jobs):
   - The round → FINALIZED and becomes read-only for the school.
   - **ALL:** §6 `EntryService.applySchoolShortlist({ institutionRegistrationId, categoryId, shortlisted: [{ entryId, schoolRank, schoolAwardLabel }], notShortlistedEntryIds })`, called once per category, moves each SUBMITTED entry to SCHOOL_SHORTLISTED or NOT_SHORTLISTED, with `schoolAwardLabel = positionLabels[position-1]`.
   - **SHORTLIST_ONLY:** no entry moves. §6 allows the Phase 7 upload only for registration × category pairs with `SchoolResult.advanced` and creates each Entry directly in SCHOOL_SHORTLISTED through `EntryService.createShortlistedEntry`, copying `schoolRank` and `schoolAwardLabel`.
   - **Certificates** (§7.7): one PARTICIPATION per Registration with a participated row (keyed by Registration, so students with no digital entry are covered) and SCHOOL_MERIT for every positioned row.
   - **Milestone:** none recorded here. §9 derives SCHOOL_WINNER from `certificate.issued` (SCHOOL_MERIT), so §7 does not call `EngagementService` directly.
   - **Event:** `schoolShortlist.finalized { roundId, competitionId, institutionRegistrationId, scope, categories: [{ categoryId, shortlistedRegistrationIds[], notShortlistedRegistrationIds[] }] }`. §7 `finalizeSchoolRound` (including a close on behalf) is its sole emitter, exactly once per school round; §6 never emits it.
   - **Messages under ALL:** §10 sends "shortlisted for further judging" and "not shortlisted" from §6's `entry.shortlisted` / `entry.notShortlisted`.
   - **Messages under SHORTLIST_ONLY:** §10 sends both messages from this event's lists. §6's later creation of the entry in SCHOOL_SHORTLISTED MUST NOT re-send `entry.shortlisted`.

### 7.4 FOA-Level Judging (Phase 9)

#### 7.4.1 Judge Assignment & Conflicts of Interest

```prisma
enum JudgeAssignmentStatus { INVITED ACCEPTED DECLINED REMOVED }
model JudgeAssignment {
  id String @id;  roundId String;  judgeUserId String /* UserRole JUDGE, scopeType COMPETITION */
  categoryIds String[];  partitionKeys String[] /* empty = all */;  status JudgeAssignmentStatus @default(INVITED)
  coiInstitutionIds String[];  coiStatement String? /* "none" is explicit */;  coiDeclaredAt DateTime?;  removedReason String?
  @@unique([roundId, judgeUserId])
}
```

- **Invitations:** sent to a user or an email address. Accepting creates the user and the scoped `JUDGE` role if needed. It requires agreeing to the code of conduct and confidentiality terms and declaring conflicts of interest.
- **Clearance:** accepting, and opening a round, run `SafeguardingService.assertCleared(judgeUserId, 'JUDGE')` (§12.9). PHYSICAL rounds count as in-person judging and require police verification.
- **Automatic conflicts:** every institution where the judge is an `InstitutionMember` is added. Any entry whose participant has the judge as `Guardian.userId` is treated as conflicted. A conflicted judge never gets a sheet for that entry, and the server never says why.
- **Distribution when the round opens:**
  - `ALL`: every ACCEPTED judge on a category scores every non-conflicted entry in it.
  - `BALANCED`: each entry gets exactly `minJudgesPerEntry` judges, least-loaded first, with seeded random tie-breaks (seed = roundId).
  - Each (judge, RoundEntry) pair gets one PENDING `ScoreSheet`.
  - Opening fails, naming the affected entries, if any entry would have fewer than `minJudgesPerEntry` eligible judges.

#### 7.4.2 Scoring, Storage, Comments, Re-scoring

```prisma
enum ScoreSheetStatus { PENDING DRAFT SUBMITTED VOID }   enum FeedbackStatus { PENDING APPROVED SUPPRESSED }
model ScoreSheet {
  id String @id;  roundId String;  roundEntryId String;  judgeAssignmentId String;  judgeUserId String
  status ScoreSheetStatus @default(PENDING);  weightedTotal Decimal? @db.Decimal(5,2)
  privateComment String?                          // FOA staff only; never shown to participants or schools
  participantFeedback String?;  feedbackStatus FeedbackStatus @default(PENDING)  // shown only if shareFeedback && APPROVED
  recommendGallery Boolean @default(false);  recommendAuction Boolean @default(false)
  enteredByUserId String?;  proxyScanAssetId String?   // PHYSICAL proxy entry by staff
  version Int @default(0);  submittedAt DateTime?;  voidReason String? /* COI|JUDGE_REMOVED|ENTRY_WITHDRAWN|ROUND_CANCELLED */
  @@unique([roundEntryId, judgeUserId])
}
model CriterionScore     { scoreSheetId String; criterionId String; score Int; @@id([scoreSheetId, criterionId]) }
model ScoreSheetRevision { id String @id; scoreSheetId String; version Int; snapshot Json; changedByUserId String; reason String?; createdAt DateTime } // append-only
```

- **Submit** requires every criterion scored as an integer from 0 to max. The server computes `weightedTotal`.
- **Re-scoring audit:** while the round is OPEN, a judge may edit their own SUBMITTED sheet. Each edit bumps `version`, writes a `ScoreSheetRevision` and an AuditLog row, and emits `scoreSheet.revised`. After SCORING_CLOSED, sheets change only if the round is reopened. The results and approval views flag re-scored sheets.
- **Feedback:** if `shareFeedback` is on, CM/SA must approve, edit or suppress each item before results are proposed. Approved feedback appears, attributed to "Judge 1..n", on `/dashboard/entries/[entryCode]` after results are PUBLISHED.

#### 7.4.3 Blind Scoring UI (`/judge/rounds/[roundId]/entries/[entryCode]`)

- **Shows:** entry code, discipline, category/age-group label, title (or `blindTitle`), description and statement, and `WEB` media only (images with zoom up to 4096 px, essay text, video player). Also the rubric with descriptions, score inputs, a live weighted total, private comment, feedback box (only if `shareFeedback`), gallery/auction recommendation toggles, "Declare conflict", Save draft (autosaves every 10 s), Submit and Prev/Next.
- **Never shows:** names, school, city, DOB, registration or participant codes, original file names, other judges' scores, aggregates or ranks. Judge routes serialize through an allow-list.
- **Queue:** shuffled per judge (seed = judgeUserId + roundId), filterable by category and status.
- **PHYSICAL mode:** judges score in the same UI on tablets at the venue, with the queue sorted by `PhysicalArtwork.artworkCode` (the only label on the work). Alternatively, a CM keys in printed per-judge paper sheets with `enterScoresOnBehalf`, which requires a scan.

#### 7.4.4 Aggregation, Ties, Advancement & Outcomes

- **Aggregation:** only SUBMITTED sheets count. `meanScore` is the mean of `weightedTotal`. `insufficientScores` means `submittedSheetCount < minJudgesPerEntry`.
- **`Z_SCORE`** (optional): for each judge, within the round and category, `z = (x − μⱼ)/σⱼ`, rescaled to `50 + 10z` and clamped to 0–100. `normalizedScore` is the mean of the rescaled values. A judge with fewer than 5 sheets in the category, or with σⱼ = 0, contributes raw totals.
- **Ranking:** within each (categoryId, partitionKey), over ACTIVE entries only, by `finalScore` descending. Results are recomputed on close and reopen, and on demand while SCORING_CLOSED.
- **Tie-breaks (default chain):**
  1. Mean criterion score as a percentage of max, comparing criteria in descending weight (rubric order breaks equal weights).
  2. The higher median `weightedTotal`.
  3. MANUAL.

  Entries still tied share a rank (1, 2, 2, 4).
- **Boundary ties:** a shared rank that straddles the advance cutoff or an award-band edge creates a `TieResolution { id, roundId, groupKey, boundary: 'ADVANCE'|'AWARD:<bandKey>', roundEntryIds[], resolution?: 'ORDER'|'SHARE', orderedEntryIds[], reason?, resolvedByUserId?, resolvedAt? }`. It must be resolved before LOCK.
  - `SHARE` at the cutoff advances every tied entry, so the cutoff expands. `SHARE` at an award edge gives all of them the better band ("Joint 2nd"). `ORDER` applies the manager's order.
  - The UI pre-selects SHARE for ADVANCE and ORDER for AWARD. A reason is always required.
- **Advancement and awards:** the top `advanceCount` per (category, partition) advance; a smaller group advances entirely. Bands are applied top-down. `specialMention` is set manually, in any round. In SCORING_CLOSED a CM may override `advanced`, `awardBandKey` or `specialMention` with `overrideRoundEntry` and a reason; overrides are highlighted at approval.
- **Outcomes:** finalizing the final round sets the following for every entry that entered FOA judging:

| Entry | `status` | `finalOutcome` | `finalAwardLabel` |
|---|---|---|---|
| In the final round and matched a band | FINALIZED | band.outcome | band.label |
| In the final round with `specialMention` and no band | FINALIZED | SPECIAL_MENTION | "Special Mention" |
| In the final round, otherwise | FINALIZED | FINALIST | "Finalist" |
| Eliminated earlier with `specialMention` in any round | ELIMINATED | SPECIAL_MENTION | "Special Mention" |
| Eliminated earlier | ELIMINATED | PARTICIPANT | highest level-award label won, else null |

- **Candidate flags** (CM can edit them until the initial release is PUBLISHED; §8 reads `auctionCandidate`):
  - `galleryCandidate` is preset for WINNER, RUNNER_UP, SPECIAL_MENTION and FINALIST, or when at least 50% of final-round sheets recommend the entry.
  - `auctionCandidate` is preset when at least 50% recommend it and its PhysicalArtwork is VERIFIED.
- **Participant view:** participants and schools see only "In FOA judging" for IN_JUDGING, ELIMINATED and FINALIZED entries until results are PUBLISHED. Eliminations in individual rounds are never notified.
- **Progress** (round page): sheets submitted out of the total; per judge, pending, draft, submitted and last activity; per category, coverage; and the list of `insufficientScores` entries.
- **Reminders and auto-close:** §10 schedules `reminder.judgingDue` from `closesAt` using `JudgingQuery.pendingSheetsByJudge(roundId)`. At `closesAt` a job tries a non-forced close; if coverage is incomplete, the round stays OPEN and `judgingRound.closeBlocked` is emitted.

### 7.5 State Machines

**FOA `JudgingRound`:**

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| DRAFT → OPEN | CM/SA `openRound`, or job at `opensAt` | Competition FOA_JUDGING. Rubric resolves. Source rounds FINALIZED. Pool not empty. Judges cleared (§12.9). Every entry has ≥ `minJudgesPerEntry` eligible ACCEPTED judges | RoundEntry snapshot. First FOA round: entries FOA_VERIFIED → IN_JUDGING. PENDING sheets. `judgingRound.opened` |
| OPEN → SCORING_CLOSED | CM/SA `closeRound`, or job | All sheets SUBMITTED or VOID, or `force` with a reason | Ranks computed. `insufficientScores` flagged. TieResolutions created. `judgingRound.closed` |
| SCORING_CLOSED → OPEN | CM/SA `reopenRound` | Reason | `judgingRound.reopened` (judges notified) |
| SCORING_CLOSED → LOCKED | CM/SA `lockRound` | No ACTIVE entry with `insufficientScores` (exclude it, or reassign and reopen). All TieResolutions resolved | `resultsHash` frozen. `judgingRound.locked` |
| LOCKED → SCORING_CLOSED | SA `unlockRound` | Reason | Hash cleared. `judgingRound.unlocked` |
| LOCKED → FINALIZED | CM/SA `finalizeRound` | None | Non-final: advanced entries stay IN_JUDGING and feed the next pool; the rest → ELIMINATED. Final: §7.4.4 outcomes and flags, then competition → RESULTS_PENDING_APPROVAL. `judgingRound.finalized` |
| DRAFT, OPEN or SCORING_CLOSED → CANCELLED | SA | Reason. No later round past DRAFT | Sheets VOID. Entries whose only round this was → FOA_VERIFIED |

**SCHOOL `JudgingRound`:**

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| DRAFT → OPEN | System | §7.3 step 1. Rubric resolves | SchoolResult sync. `schoolRound.opened` |
| OPEN → FINALIZED | IA/IC `finalizeSchoolRound`, or CM/SA `closeSchoolRoundOnBehalf` | V1–V7 | §7.3 step 4 |
| FINALIZED → OPEN | CM/SA `reopenSchoolRound` | Reason. The §6.9 `revertSchoolShortlist` guard holds for every category: no entry of this institution × category is FOA_VERIFIED or later | §6 `EntryService.revertSchoolShortlist({ institutionRegistrationId, categoryId })` per category: entries revert to SUBMITTED (ALL), or entries created by §6.9 row 7 are soft-deleted (SHORTLIST_ONLY). SCHOOL_MERIT certificates REVOKED; PARTICIPATION certificates are revoked only for registrations whose rows are all later unticked. `schoolRound.reopened` |

**`EntryStatus` (the transitions §7 owns):**

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| FOA_VERIFIED → IN_JUDGING | System (`openRound`, `syncRoundPool`) | In pool scope. Physical guard passes | RoundEntry created |
| IN_JUDGING → IN_JUDGING | System (non-final `finalizeRound`) | `advanced` | Joins the next round's pool |
| IN_JUDGING → ELIMINATED | System (non-final `finalizeRound`) | Not advanced, or EXCLUDED | Outcome set at the final finalize |
| IN_JUDGING → FINALIZED | System (final `finalizeRound`) | None | `finalOutcome`, `finalAwardLabel` |
| IN_JUDGING → FOA_VERIFIED | System (round CANCELLED) | The entry's only round | RoundEntry removed |
| IN_JUDGING, ELIMINATED or FINALIZED → DISQUALIFIED | CM/SA `disqualifyEntry` (from FINALIZED: SA only) | Reason | RoundEntry DISQUALIFIED. §7.15 E3. `entry.disqualified` |
| IN_JUDGING → WITHDRAWN | §6's service: SA `withdrawEntry`, or the cascade from a Registration becoming WITHDRAWN (including the system acting on `consent.withdrawn` for PARTICIPATION, §12.6) | Per §6 | RoundEntry WITHDRAWN, sheets VOID |
| ELIMINATED or FINALIZED → WITHDRAWN | Same as IN_JUDGING → WITHDRAWN | Per §6 | RoundEntry WITHDRAWN. If results are already published, a §7.15 E3 correction follows (certificates revoked, results corrected) |

### 7.6 Results Approval & Publishing (Phase 10)

```prisma
enum ResultsReleaseStatus { PROPOSED APPROVED REJECTED PUBLISHED SUPERSEDED }
model ResultsRelease {
  id String @id;  competitionId String;  version Int /* 1 = initial, ≥ 2 = correction */;  status ResultsReleaseStatus @default(PROPOSED)
  snapshot Json      // per level/category ordered {entryId, entryCode, rank, finalScore, outcome, awardLabel}; overrides,
                     // tie resolutions, re-scored sheets, COI voids, setMinJudges changes, diff vs previous version
  snapshotHash String;  publishAt DateTime /* embargo end; default = approval time */;  publicNote String?;  correctionReason String?
  proposedByUserId String;  proposedAt DateTime;  approvedByUserId String?;  approvedAt DateTime?;  rejectionReason String?;  publishedAt DateTime?
  @@unique([competitionId, version])
}
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PROPOSED | CM/SA `proposeResults` / `proposeCorrection` | Initial: competition RESULTS_PENDING_APPROVAL, all FOA rounds FINALIZED, no entry IN_JUDGING, feedback moderated. An ACTIVE template exists for each needed type. No open PROPOSED/APPROVED release | Snapshot and hash. `results.approvalRequested` (to SAs) |
| PROPOSED → APPROVED | SA `approveResults` (step-up 2FA, §13.1) | **Approver ≠ proposer.** Recomputed hash = `snapshotHash`. `publishAt` ≥ now | Publish job scheduled. `results.approved` |
| PROPOSED or APPROVED → REJECTED | SA `rejectResults`, or the publish job on a stale hash | Reason | `results.rejected` |
| APPROVED → PUBLISHED | Job at `publishAt` (plus a 1-minute sweeper) | Still APPROVED. Hash valid | See below. Previous PUBLISHED → SUPERSEDED |

- **Embargo:** between APPROVED and `publishAt`, only CM and SA can see results. Nothing participant-facing happens: no outcomes shown, no FOA-level certificates, notifications or gallery candidates. The page says "Results will be announced soon".
- **Initial publish effects:**
  1. Competition → RESULTS_PUBLISHED, and outcomes become visible.
  2. Certificates created (§7.7).
  3. PrizeFulfilment rows created for bands that have a `prizeId`, from the linked §6 CompetitionPrize.
  4. GalleryItem CANDIDATE created for each `galleryCandidate` entry if `allowPublicDisplay`.
  5. No milestone call. §9 derives FOA_FINALIST from `results.published` using `finalOutcome`.
  6. `results.published` emitted (§10 fans it out to participants, guardians and schools), and the worker revalidates the cache tag `results:{competitionId}` through the internal route (§2.2).
- **`/competitions/[slug]/results`** (cached with `cacheTag('results:{competitionId}')`, revalidated on publish, correction or consent change):
  - **Layout:** tabs per discipline, then sections per category. Each section lists award bands in order, then special mentions, then finalists alphabetically. Level awards from non-final rounds appear under "{Level} awards".
  - **Name:** when `ConsentService.has(participantId, PUBLIC_DISPLAY, competitionId)` holds, the §12.7 public name (minors: "Aarav S." unless `showFullName`). Otherwise "{entryCode} · Name withheld".
  - **Institution:** shown only with that consent and §12.7 `showSchool`.
  - **Never shown:** city, age or DOB.
  - Every row has a "Report" link (§12.8).
  - **Thumbnail:** only when a PUBLISHED GalleryItem exists, linking to it.
  - **Also:** aggregate counts and, after a correction, "Updated on {date}" with the `publicNote`.
  - School-level results are never public.
- **Corrections:** `proposeCorrection({ mode, changes[], publicNote, reason })` follows the same two-person rule. Finalized rounds are never reopened.
  - **Modes:** `PROMOTE_NEXT` re-applies the final round's bands to its locked ranking without DISQUALIFIED or WITHDRAWN entries. `LEAVE_GAP` leaves the band vacant. `MANUAL` takes per-entry outcome changes, each with a reason.
  - **On publish, for each changed entry:** old certificates → REVOKED ("Results corrected") and new ones are issued. Lost PENDING prizes → CANCELLED; DISPATCHED or DELIVERED ones get `recoveryRequired`. New awards get PENDING prizes. Gallery recognition is updated. `results.corrected` is emitted with `affectedEntryIds`.

### 7.7 Certificates (Module 31)

```prisma
enum CertificateStatus { PENDING GENERATED FAILED REVOKED SUPERSEDED }
model Certificate {
  id String @id;  certificateNumber String @unique /* §3.1, assigned at creation */;  type CertificateType
  status CertificateStatus @default(PENDING);  competitionId String?;  registrationId String?;  participantId String?
  subjectUserId String? /* VOLUNTEER_SERVICE: the volunteer */;  data Json? /* VOLUNTEER_SERVICE: hours, period, skills */
  // CHECK: exactly one of participantId / subjectUserId is set; competitionId and registrationId are required unless type = VOLUNTEER_SERVICE
  entryId String?;  categoryId String? /* null for PARTICIPATION */;  roundId String? /* awarding round */;  institutionId String?;  level JudgingLevel?;  awardLabel String?
  nameSnapshot String /* PDF: fullName (Q9) */;  displayNameSnapshot String /* §12.7 public name: /verify, CERT_SHARE */;  categoryLabel String
  templateId String;  templateVersion Int;  pdfAssetId String? /* FileAsset PDF, private */
  issuedAt DateTime?;  revokedAt DateTime?;  revokedReason String? /* internal */;  supersededById String?
  // partial unique (registrationId, categoryId, type, roundId) NULLS NOT DISTINCT WHERE status IN (PENDING, GENERATED, FAILED)
  //   AND type <> VOLUNTEER_SERVICE; PARTICIPATION (categoryId null) stays one per registration
}
model CertificateTemplate {
  id String @id;  type CertificateType;  competitionId String? /* null = global default */;  name String
  html String;  css String;  version Int;  status String /* DRAFT|ACTIVE|ARCHIVED */
  pageSize String @default("A4");  orientation String @default("LANDSCAPE")
  signatories Json /* [{name, title, signatureAssetId}] ≤ 3 */;  backgroundAssetId String?
}
```

| CertificateType | Trigger | Recipients |
|---|---|---|
| PARTICIPATION | `finalizeSchoolRound` (institution route) | One per Registration with a participated SchoolResult |
| PARTICIPATION | Initial release PUBLISHED (individual route) | Individual registrations whose entry reached SUBMITTED and is not WITHDRAWN, DISQUALIFIED or REJECTED_INELIGIBLE |
| SCHOOL_MERIT | `finalizeSchoolRound` | Positioned rows (`awardLabel` = position label) |
| FINALIST / WINNER / RUNNER_UP / SPECIAL_MENTION | Release PUBLISHED | One per entry by `finalOutcome` (a winning finalist gets WINNER only), plus one per level award won in a non-final round (`level`, band label) |
| VOLUNTEER_SERVICE | §9.8 `issueVolunteerCertificate` | The volunteer (`subjectUserId`), with data (hours, period, skills) |

- **Templates:** the ACTIVE template for `(type, competitionId)` is used, falling back to `(type, null)`.
  - Merge fields: `{{name}}`, `{{displayName}}`, `{{competitionName}}`, `{{competitionYear}}`, `{{categoryLabel}}`, `{{awardLabel}}`, `{{levelLabel}}`, `{{institutionName}}`, `{{issueDate}}` (IST, `d MMM yyyy`), `{{certificateNumber}}`, `{{qrSvg}}`, `{{verifyUrl}}`, `{{foaLogoUrl}}`, `{{#signatories}}`.
  - Rendering is Handlebars with escaping on, no triple-stash and no custom helpers.
  - A template becomes ACTIVE only after a successful preview render.
  - Issued PDFs are immutable: template edits never re-render them, only reissue does.
- **Generation:** job `certificate.generate(id)` skips GENERATED certificates.
  - **Render:** Playwright HTML→PDF in `worker-media`, with Noto fonts (Latin, Devanagari and other Indic scripts) bundled in the image. The worker reads the template's images (FOA logo, signatures, background) from storage and inlines them as `data:` URLs. Every other request is blocked. Timeout 30 s.
  - **QR:** the `qrcode` package encodes `{APP_URL}/verify/{certificateNumber}`.
  - **Store and issue:** the PDF goes to `certificates/{competitionCode}/{certificateNumber}.pdf` (private) as a FileAsset of kind PDF. The certificate → GENERATED and `certificate.issued` is emitted.
  - **Retries:** at 1 min, 10 min and 1 h, then FAILED.
  - **Throughput:** at least 5,000 certificates in 30 minutes on 4 workers.
- **`/verify/[certificateNumber]`:** public, `noindex`, 30 requests per minute per IP. The input is normalized (uppercase; Crockford O→0, I/L→1).
  - **Shows:** the §12.7 public name, competition and year, type and award label, issue date, and **VALID** (GENERATED) or **REVOKED** (REVOKED or SUPERSEDED; superseded adds "Replaced by a reissued certificate").
  - **VOLUNTEER_SERVICE:** shows the display name, "Volunteer service", the period, hours and status. No competition.
  - **Never shows:** DOB, age, city or school, and no full name unless `showFullName` is set. The institution name appears only with PUBLIC_DISPLAY consent and `showSchool`.
  - PENDING, FAILED and unknown numbers return the same 404.
- **Downloads:** `/dashboard/certificates` serves participants and guardians (every linked participant). It offers the PDF (signed URL, 5 min), a "Share image" (CERT_SHARE, private) and the verify link.
  - `/institution/competitions/[code]/certificates` lists every certificate for the institution's registrations. `requestCertificateBundle` builds a ZIP (`{participantCode}_{type}_{certificateNumber}.pdf`) as a private FileAsset of kind OTHER, valid 7 days, and emits `certificateBundle.generated`.
  - FOA-level certificates appear only after results are PUBLISHED. Only staff can download revoked or superseded PDFs.

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PENDING | System (trigger table) | No live certificate for (registrationId, categoryId, type, roundId) | Number assigned (collision retry). Job enqueued |
| PENDING → GENERATED / FAILED | Job | PDF stored / retries exhausted | `certificate.issued` / admin alert |
| FAILED → PENDING | CM/SA `regenerateCertificate` | None | Re-enqueued |
| GENERATED → REVOKED | CM/SA `revokeCertificate`, school reopen, correction, DQ | Reason | `/verify` shows REVOKED. CERT_SHARE deleted. `certificate.revoked` |
| GENERATED → SUPERSEDED | CM/SA `reissueCertificate` | Reason (e.g. name fix) | New certificate with a **new number**. `certificate.revoked` |

### 7.8 Prize Fulfilment

```prisma
enum PrizeFulfilmentStatus { PENDING DISPATCHED DELIVERED CANCELLED }   // PrizeType is §6's, on CompetitionPrize
model PrizeFulfilment {
  id String @id;  competitionId String;  entryId String;  participantId String;  certificateId String?
  competitionPrizeId String /* §6 CompetitionPrize from AwardBand.prizeId: prizeType, description, cash amount */
  deliverTo String          // INSTITUTION (default, institution route) | PARTICIPANT (default, individual) | HAND_OVER
  addressSnapshot Json?     // confirmed on /dashboard/entries/[entryCode] or /institution/.../results; purged 90 days after DELIVERED
  status PrizeFulfilmentStatus @default(PENDING);  courier String?;  trackingNumber String?;  proofAssetId String?
  recoveryRequired Boolean @default(false);  dispatchedAt DateTime?;  deliveredAt DateTime?;  notes String?
}
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PENDING | System at release PUBLISHED | Band has a `prizeId` whose CompetitionPrize is not CERTIFICATE_ONLY | `prizeFulfilment.created` (§10 sends the address request) |
| PENDING → DISPATCHED | CM/SA | Address, courier and tracking (all waived for HAND_OVER) | `prize.dispatched`. CASH: `LedgerService.record({ type: 'EXPENSE', category: 'PRIZES_AWARDS', sourceType: 'PRIZE_FULFILMENT', … })` |
| DISPATCHED → DELIVERED | CM/SA | None | `prize.delivered` |
| PENDING → CANCELLED | CM/SA, correction | Reason | None |

### 7.9 Logo Stamping: `StampService` (Module 32)

```prisma
enum StampVariant { GALLERY SOCIAL_SQUARE SOCIAL_PORTRAIT CERT_SHARE }   enum StampPosition { TOP_LEFT TOP_RIGHT BOTTOM_LEFT BOTTOM_RIGHT }
model StampSettings {     // competitionId null = global; a competition row overrides it
  id String @id;  competitionId String? @unique;  logoAssetId String /* PNG with alpha; SVG rasterized on upload */
  position StampPosition @default(BOTTOM_RIGHT);  logoWidthPct Int @default(14) /* 8–25 */;  marginPct Int @default(4)
  opacity Decimal @default(0.9);  codeWatermark Boolean @default(true) /* code in the opposite bottom corner */
  socialBackground String @default("#FFFFFF");  version Int;  updatedByUserId String;  updatedAt DateTime
}
model StampedDerivative {
  id String @id;  sourceAssetId String;  variant StampVariant;  settingsHash String;  outputAssetId String;  thumbAssetId String?
  @@unique([sourceAssetId, variant, settingsHash])
}
```

**Interface** (a compatible extension of §3.5): `StampService.stamp(fileAssetId, { variant: 'GALLERY'|'SOCIAL'|'CERT_SHARE', aspect?: 'SQUARE'|'PORTRAIT' }) → FileAsset (kind STAMPED)`. `aspect` applies to SOCIAL only and defaults to SQUARE.

1. **Idempotency:** `settingsHash = sha256(canonicalJSON(effective settings) + logo.checksumSha256 + variant + STAMP_PIPELINE_VERSION)`. If a StampedDerivative exists for (source, variant, hash), it is returned unchanged. Concurrent calls serialize on `pg_advisory_xact_lock`.
2. **Source:** depends on the content.
   - **Image entry:** the given ORIGINAL or WEB asset (scanStatus CLEAN), read on the server only. §7 passes the ORIGINAL; §8 may pass WEB.
   - **Video:** the §6 poster frame.
   - **Essay:** a Playwright-rendered "essay card" (title plus up to 60 words).
   - **CERT_SHARE:** the certificate's 1080×1350 share layout (display name and QR), rendered by Playwright.
3. **sharp:**
   - Apply EXIF orientation with `.rotate()` and convert to sRGB.
   - Apply the variant geometry.
   - Composite the logo (`logoWidthPct`, alpha × opacity) at `position` inside `marginPct`, then the code as SVG text (font 2.2% of width, 70% opacity, 1 px shadow).
   - Encode as JPEG q85 with mozjpeg. `withMetadata()` is never called, so EXIF, GPS and XMP are dropped.
4. **Geometry:**
   - **GALLERY:** longest edge ≤ 2048 px, no upscaling. A 480 px thumbnail is resized *from the stamped output*, so it carries the logo. It is encoded at q70, stepping down to q50 if needed, to stay ≤ 60 KB (§13.2 budget).
   - **SOCIAL_SQUARE** (1080×1080): the artwork is fitted (`contain`) into a centred 952×952 box on `socialBackground`. Logo and code stay within a 64 px safe margin.
   - **SOCIAL_PORTRAIT** (1080×1350): the artwork fills the top 1080×1150 with 48 px padding. The bottom 200 px is the **caption-safe band**: background only, logo on the left, code on the right, no artwork.
   - **CERT_SHARE** (1080×1350).
5. **Storage:** GALLERY and SOCIAL variants go to the public CDN bucket. CERT_SHARE goes to the private bucket, served by signed URL, because certificates are personal. Keys are `stamped/{variant}/{sourceChecksum[0..16]}-{settingsHash[0..12]}.jpg` and contain no names or codes. The output FileAsset has `kind STAMPED` and the source's owner.

- **Hard rule:** public pages, OG/Twitter meta tags, sitemaps, the results page, images linked from emails and social packs use only `kind = STAMPED`.
  - `toPublicImageUrl(asset)` throws for anything else. Public components accept only its branded `PublicImageUrl` type.
  - ORIGINAL assets are never served publicly. WEB assets are served only by signed URL to authorized viewers.
  - **MVP video exception:** the player streams the §6 WEB transcode with a STAMPED poster and a fixed CSS logo overlay (Q12).
- **Restamping:** `updateStampSettings` bumps `version` and enqueues `stamp.restamp_all`. That job restamps every source used by APPROVED or PUBLISHED GalleryItems and DRAFT or READY SocialExports, swaps each reference atomically, and deletes superseded public objects after 7 days. Posted exports keep their historical assets. Re-running it with unchanged settings does nothing.

### 7.10 Gallery (Phase 11, Module 4)

```prisma
enum GalleryItemStatus { CANDIDATE APPROVED PUBLISHED UNPUBLISHED REJECTED }
enum GalleryRecognition { WINNER RUNNER_UP SPECIAL_MENTION FINALIST SCHOOL_MERIT PARTICIPANT }
model GalleryItem {
  id String @id;  entryId String @unique;  competitionId String;  participantId String;  status GalleryItemStatus @default(CANDIDATE)
  title String;  story String? /* ≤ 500 chars, moderated */;  displayNameSnapshot String /* §12.7 public name, refreshed at each approval */
  categoryLabel String /* "Painting · 9–12 years"; never DOB/age */;  discipline Discipline;  year Int
  institutionNameSnapshot String?;  city String?;  state String?;  country String?
  showInstitution Boolean @default(true);  showCity Boolean @default(true)  // moderator veto; effective = toggle AND §12.7 showSchool / showCity
  isAdult Boolean /* ≥ 18 at publish; gates the sitemap (§13.6) */;  moderationReviewId String? /* §12.8 ModerationReview */
  recognition GalleryRecognition /* finalOutcome ?? (schoolRank ? SCHOOL_MERIT : PARTICIPANT) */;  recognitionLabel String
  imageAssetId String?;  thumbAssetId String?;  ogImageAssetId String? /* STAMPED GALLERY / thumb / SOCIAL_SQUARE */
  essayMode String @default("EXCERPT") /* or FULL */;  essayExcerpt String? /* default first 120 words */;  videoAssetId String?
  featured Boolean @default(false);  featuredRank Int?;  unpublishReason String? /* MODERATOR|CONSENT_WITHDRAWN|DISQUALIFIED|REPORTED|ERASURE */
  searchVector Unsupported("tsvector") /* title, story, displayName, competition name */
  approvedByUserId String?;  approvedAt DateTime?;  publishedAt DateTime?;  unpublishedAt DateTime?
}
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → CANDIDATE | System at release PUBLISHED (`galleryCandidate`), or CT/CM/SA `addGalleryCandidate` | Competition RESULTS_PUBLISHED. `allowPublicDisplay`. Entry not WITHDRAWN or DISQUALIFIED | Fields snapshotted |
| CANDIDATE → APPROVED | CT/CM/SA | `ConsentService.has(participantId, PUBLIC_DISPLAY, competitionId)`. A §12.8 `ModerationReview` for the item is APPROVED (checklist: consent, faces, PII, age-appropriate, matches entry) | Stamp jobs (GALLERY + SOCIAL_SQUARE) |
| CANDIDATE → REJECTED | CT/CM/SA | Reason | None |
| APPROVED → PUBLISHED | CT/CM/SA (bulk allowed) | Stamped assets ready. Consent re-checked | Listed (sitemap only if `isAdult`). Cache tags revalidated (§2.2). `galleryItem.published` |
| PUBLISHED or APPROVED → UNPUBLISHED | CT/CM/SA (reason), or system: `consent.withdrawn` (PUBLIC_DISPLAY), §12 `consent.reconcile`, DQ, §12.8 auto-hide (REPORTED), §12 erasure | None | Delisted. Detail page returns 410. Consent withdrawal or erasure: public objects deleted and purged from the CDN. `galleryItem.unpublished` |
| UNPUBLISHED → APPROVED | CT/CM/SA | Not ERASURE. Consent present. New APPROVED review if REPORTED | Restamped if the objects were deleted |

- **Consent withdrawal SLA** (§12.6): gone from every public page, the sitemap and the results page within **15 minutes** (high-priority job plus cache-tag revalidation through the internal route, §2.2). The same job deletes the public objects and purges their URLs from the Cloudflare CDN (credentials in §13.9): target 15 minutes, hard limit **24 hours**. Handlers and §12's `consent.reconcile` both call `GalleryService.unpublishForConsent(participantId, competitionId, reason)`.
- **`/gallery`:**
  - **Filters:** `competition`, `discipline`, `age` (category), `year`, `recognition`.
  - **Search:** `q` uses `websearch_to_tsquery('simple', q)` plus `pg_trgm` on `displayNameSnapshot`.
  - **Sort and paging:** featured (`featuredRank`), then recognition, then `publishedAt` desc. 24 per page with a cursor.
  - **Featured:** at most 12 items. `GalleryQuery.featured(limit)` feeds the home page (§9).
- **`/gallery/[entryCode]`:**
  - **Content:** the STAMPED image with a lightbox, title, the §12.7 public name, category, competition link, recognition badge and story. Location is state and country by default; city and institution appear only when both the §12.7 pref and the item toggle allow them. A "Report" link is present (§12.8).
  - **Essays and videos:** essays show the excerpt, or the full sanitized text. Videos play in the player.
  - **Share buttons:** WhatsApp, Facebook, X, copy link and Web Share.
  - **Meta tags:** `og:title` "{title} by {publicName}", `og:image` = `ogImageAssetId` with width and height, `twitter:card=summary_large_image`, and a canonical URL. Hidden fields never appear in meta tags.

### 7.11 Social Media Showcase (`/admin/social`)

```prisma
model SocialExport {
  id String @id;  entryId String;  galleryItemId String?;  certificateId String?;  kind String /* ARTWORK|ESSAY_CARD|CERTIFICATE */
  status String @default("DRAFT") /* DRAFT|READY|CANCELLED */;  squareAssetId String?;  portraitAssetId String?;  certShareAssetId String?
  caption String;  acknowledgementLine String /* cannot be removed */;  createdByUserId String;  readyAt DateTime?
}
model SocialPostRecord {
  id String @id;  socialExportId String;  platform String /* INSTAGRAM|FACEBOOK|X|LINKEDIN|YOUTUBE|WHATSAPP|OTHER */
  source String @default("MANUAL") /* API reserved for post-MVP */;  postedUrl String?;  postedAt DateTime;  postedByUserId String
  status String @default("LIVE") /* LIVE|TAKEDOWN_REQUIRED|TAKEN_DOWN */;  takedownDueAt DateTime?;  takenDownAt DateTime?;  note String?
}
```

- **Tabs:** Candidates (PUBLISHED gallery items and awarded entries with SOCIAL_MEDIA consent and no export yet), Drafts, Ready, Posted (the post log), Takedowns.
- **`createSocialExport`:**
  - **Requirements:** RESULTS_PUBLISHED, `allowPublicDisplay`, entry not WITHDRAWN or DISQUALIFIED, and `ConsentService.require` for both PUBLIC_DISPLAY and SOCIAL_MEDIA (§12.4).
  - **Stamping:** SOCIAL_SQUARE and SOCIAL_PORTRAIT, or CERT_SHARE for a certificate export.
  - **Caption draft:** `"{title}" by {publicName} ({categoryLabel}): {recognitionLabel}, {competitionName}.\n{story excerpt}\n{acknowledgementLine}\n#FriendsOfAnimals`. `publicName` follows §12.7.
  - **Acknowledgement line:** "Artwork by {publicName}. Thank you, {publicName}, for sharing your compassion for animals with FOA."
  - **Location:** institution and city appear only when both §12.7 and the item toggles allow them.
- **`markSocialExportReady`** requires an APPROVED §12.8 `ModerationReview` of the export, the acknowledgement line verbatim, and a caption of at most 2,200 characters. "Download pack" gives a signed-URL ZIP of the images plus `caption.txt`.
- **`recordSocialPost`** creates one record per platform after manual posting, re-checking consent first (blocked if consent was withdrawn). It emits `socialFeature.published` so §10 can tell the participant and give the withdraw link.
- **Takedowns:** on `consent.withdrawn` (SOCIAL_MEDIA, including §12's cascade from PUBLIC_DISPLAY), DQ or erasure:
  - DRAFT and READY exports → CANCELLED immediately.
  - LIVE records → TAKEDOWN_REQUIRED, with `takedownDueAt = now + 72 h` (§12.6), emitting `socialPost.takedownRequired` to CT.
  - Records still pending at the due time emit `socialPost.takedownOverdue` to SA.
  - TAKEN_DOWN requires a note. Third-party reshares cannot be recalled; §12 informs the guardian.

### 7.12 Pages

| Route | Roles | Purpose |
|---|---|---|
| `/competitions/[slug]/results`, `/gallery`, `/gallery/[entryCode]`, `/verify/[certificateNumber]` | Public | §7.6, §7.10, §7.7 |
| `/judge`, `/judge/invitations/[assignmentId]` | J | Invitations, assigned rounds, deadlines, own progress; accept with code of conduct and COI |
| `/judge/rounds/[roundId]` (+ `/framework`), `…/entries/[entryCode]` | J | Queue (category/status filters), rubric and guidance; blind scoring (§7.4.3) |
| `/institution/competitions/[code]/judging` | IA/IC | Framework and PDF, panel, results grid, certify and finalize, deadline status |
| `/institution/competitions/[code]/certificates`, `…/results` | IA/IC | Certificate list, downloads, bulk ZIP; school results; own students' FOA outcomes after publish; prize address |
| `/dashboard/certificates`, `/dashboard/entries/[entryCode]` | P/G | Certificates, share image, verify link; status, outcome, approved feedback, prize address |
| `/admin/competitions/[id]/judging` (+ `/rubrics/[rubricId]`, `/schools`) | CM/SA | Pipeline overview; rubric editor with PDF preview; per-school board (status, overdue, extend, reopen, close on behalf) |
| `…/judging/rounds/[roundId]` | CM/SA (unlock: SA) | Tabs: Config · Pool (incl. Blocked) · Judges · Progress · Results & Ties · Feedback; printable physical sheets |
| `…/judging/results` | CM/SA (approve: SA) | Releases: propose, approve/reject, schedule, corrections, diff |
| `/admin/certificates` (+ `/templates/[id]`, `/prizes`) | CM/SA | Search by number, name or competition; regenerate, revoke, reissue; template editor with live preview; prize board |
| `/admin/gallery` (+ `/[itemId]`), `/admin/social` (+ `/[exportId]`, `/stamping`) | CT/CM/SA (stamping: SA, CT) | Moderation tabs, editor, featured order; export queue, post log, takedowns; logo settings with live preview |

### 7.13 Server Actions

| Action | Input | Authorization | Effect |
|---|---|---|---|
| `upsertRubric` / `publishRubric` | competitionId, discipline?, title, guidanceHtml, criteria[] / rubricId | CM/SA | Save DRAFT (new version if one is PUBLISHED) / publish, archive the previous, PDF job, `rubric.published` |
| `setSchoolJudgingPolicy` | competitionId, fields | CM/SA | Upsert. No changes once any school round is FINALIZED (the deadline is §6's `shortlistSubmissionClosesAt`) |
| `saveSchoolPanel` / `saveSchoolResults` | roundId, members[] / rows[] | IA/IC, round OPEN | Replace the panel / upsert drafts with per-row errors |
| `finalizeSchoolRound` | roundId, certify: true, shortfallReason? | IA/IC | §7.3 |
| `reopenSchoolRound` / `extendSchoolDeadline` / `closeSchoolRoundOnBehalf` | roundId, reason / until / mode, rows?, evidenceAssetId, reason | CM/SA | §7.5 / §6 `SubmissionExtension(SHORTLIST)` for the InstitutionRegistration / §7.15 E5 |
| `createRound` / `updateRound` | competitionId, config | CM/SA, DRAFT only | Validates level order, partitions, bands, single `isFinal` |
| `inviteJudges` / `respondToInvite` | roundId, [{userId \| email, categoryIds, partitionKeys?}] / assignmentId, accept, COI, agreements | CM/SA / J (self) | INVITED (`judgeAssignment.created`) / ACCEPTED or DECLINED (clearance checked) |
| `openRound` / `syncRoundPool` / `closeRound` / `reopenRound` | roundId, force?, reason? | CM/SA, job | §7.5. Sync adds newly eligible entries while OPEN |
| `excludeRoundEntry` / `setBlindTitle` / `setMinJudges` | roundEntryId, reason / blindTitle / roundId, value ≥ 1, reason | CM/SA | EXCLUDED (counts as not advanced) / redaction / lower coverage requirement (audited, shown at approval) |
| `saveScoreSheet` / `submitScoreSheet` | sheetId, scores[], comments, recommend flags | J (own), OPEN | Draft or submit. Edits after submit are revisioned |
| `declareConflict` | sheetId, reason | J (own), OPEN | Sheet VOID (COI). Replacement auto-assigned if coverage drops below the minimum |
| `enterScoresOnBehalf` | sheetId, scores[], scanAssetId | CM/SA, PHYSICAL | Same as submit, setting `enteredByUserId` |
| `removeJudge` / `reassignSheets` | assignmentId, reason / roundId, roundEntryIds[], judgeUserId | CM/SA | §7.15 E1 / new COI-checked PENDING sheets |
| `resolveTie` / `overrideRoundEntry` | tieResolutionId, resolution, order?, reason / roundEntryId, fields, reason | CM/SA, SCORING_CLOSED | Recompute / recorded override |
| `lockRound` / `unlockRound` / `finalizeRound` | roundId, reason (unlock) | CM/SA; unlock SA only | §7.5 |
| `moderateFeedback` / `setCandidateFlags` | sheetId, APPROVE \| SUPPRESS, text? / entryId, flags | CM/SA | §7.4.2 / §7.4.4 |
| `disqualifyEntry` | entryId, reason, evidenceAssetId? | CM/SA; from FINALIZED, SA only | §7.15 E3 |
| `proposeResults` / `proposeCorrection` | competitionId, publishAt? / mode, changes[], publicNote, reason | CM/SA | New PROPOSED release |
| `approveResults` / `rejectResults` / `reschedulePublish` | releaseId, reason? / publishAt | SA, not the proposer | §7.6 |
| `upsertCertificateTemplate` / `activateCertificateTemplate` | fields / templateId | CM/SA | ACTIVE requires a successful preview |
| `regenerateCertificate` / `revokeCertificate` / `reissueCertificate` | certificateId, reason? | CM/SA | §7.7 |
| `getCertificateDownloadUrl` / `createCertificateShareImage` | certificateId | Owner P/G, IA/IC (own), CM/SA / owner P/G | 5-minute signed URL (GENERATED only, unless staff) / CERT_SHARE (private) |
| `requestCertificateBundle` | competitionId | IA/IC | ZIP job |
| `confirmPrizeAddress` / `markPrizeDispatched` / `markPrizeDelivered` / `cancelPrize` | prizeId, address / courier, tracking / proof? / reason | P/G or IA/IC (own) / CM/SA | §7.8 |
| `addGalleryCandidate` / `approveGalleryItem` / `rejectGalleryItem` / `publishGalleryItem` / `unpublishGalleryItem` / `setFeatured` | entryId / itemId(s), edits, reason, featured, rank | CT/CM/SA | §7.10 (at most 12 featured) |
| `createSocialExport` / `updateSocialExport` / `markSocialExportReady` / `cancelSocialExport` / `recordSocialPost` / `markTakenDown` | entryId \| certificateId / exportId, caption / platform, postedUrl, postedAt / postRecordId, note | CT/CM/SA | §7.11 |
| `updateStampSettings` | settings, competitionId? | SA, CT | `version`++, restamp job, `stampSettings.updated` |

### 7.14 Domain Events (for §10, §11)

| Event | Emitted when | Payload |
|---|---|---|
| `rubric.published` | Rubric published | competitionId, rubricId, discipline |
| `schoolRound.opened` / `.overdue` / `.reopened` | Open / `shortlistSubmissionClosesAt` (or extension) passed, round OVERDUE (§7.15 E5) / §7.5 | roundId, institutionRegistrationId, deadline |
| `schoolShortlist.finalized` | School round FINALIZED (incl. on behalf) | §7.3 step 4 payload |
| `judgeAssignment.created` | Invitation | assignmentId, roundId, categoryCount, closesAt (no participant PII) |
| `judgingRound.opened` / `.closed` / `.closeBlocked` / `.reopened` / `.locked` / `.unlocked` / `.finalized` | §7.5 | roundId, level, competitionId |
| `scoreSheet.revised`, `entry.disqualified` | Post-submit edit; DQ | sheetId, version; entryId, competitionId |
| `results.approvalRequested` / `.approved` / `.rejected` / `.published` / `.corrected` | §7.6 | competitionId, releaseId, version, affectedEntryIds (correction only) |
| `certificate.issued` / `.revoked`, `certificateBundle.generated` | §7.7 | certificateId, type, participantId or subjectUserId, registrationId?; institutionId, fileAssetId |
| `prizeFulfilment.created` | PrizeFulfilment created (§7.8) | prizeId, entryId, participantId, deliverTo |
| `prize.dispatched` / `prize.delivered` | §7.8 | prizeId, participantId, trackingNumber? |
| `galleryItem.published` / `.unpublished` | §7.10 | itemId, entryId, visibleFields[], reason? |
| `socialFeature.published` | `recordSocialPost` | postRecordId, participantId, platform, postedUrl |
| `socialPost.takedownRequired` / `.takedownOverdue`, `stampSettings.updated` | §7.11; §7.9 | postRecordId, platform, takedownDueAt; version |

Reminders are scheduled by §10, not emitted here: `reminder.schoolJudgingDeadline` from §6 `shortlistSubmissionClosesAt` or the school's `SubmissionExtension(SHORTLIST)`, and `reminder.judgingDue` from `closesAt`.

### 7.15 Edge Cases

- **E1. A judge drops out mid-round.** `removeJudge` sets the assignment to REMOVED.
  - If the judge had submitted every sheet, those sheets are kept. Otherwise **all** of the judge's sheets in the round → VOID (`JUDGE_REMOVED`), so every entry in a category keeps the same judge set.
  - Entries that fall below the minimum are listed. The CM invites a replacement or uses `reassignSheets` (under ALL, the replacement gets the whole category), or lowers the minimum with `setMinJudges`.
- **E2. Tie at a cutoff:** handled by §7.4.4. LOCK is blocked until it is resolved. SHARE expands the cutoff and enlarges the next round's pool.
- **E3. Entry disqualified after results are published.**
  - The entry → DISQUALIFIED, and all of its certificates → REVOKED immediately.
  - Its GalleryItem → UNPUBLISHED, and LIVE social posts → TAKEDOWN_REQUIRED.
  - A PROMOTE_NEXT correction is drafted. It takes effect, with new certificates, only after a second person approves it.
  - Prizes: PENDING → CANCELLED. Dispatched prizes get `recoveryRequired`.
- **E4. Consent withdrawn after a social post:** handled by §7.11 (72-hour takedown, then escalation). Withdrawing SOCIAL_MEDIA alone leaves the gallery untouched. Withdrawing PUBLIC_DISPLAY cascades to both (§12.6).
- **E5. A school never finalizes.**
  - §10 reminders go out at −7 d, −2 d and −1 d. At §6 `shortlistSubmissionClosesAt` (or the school's later `SubmissionExtension(SHORTLIST)`), a round that is not FINALIZED becomes OVERDUE: it stays OPEN, shows as overdue on the per-school board, and `schoolRound.overdue` goes to IA, IC and CM. There is **no automatic finalise and no automatic forfeit**.
  - The school can still finalize while the round is OVERDUE. Otherwise the CM uses `closeSchoolRoundOnBehalf` in one of two modes:
    - **`PARTICIPATION_ONLY`:** every confirmed registration with a SUBMITTED entry (ALL), or every confirmed registration (SHORTLIST_ONLY), is marked participated. Entries → NOT_SHORTLISTED, and PARTICIPATION certificates are issued.
    - **`STAFF_ENTERED`:** staff enter results from evidence the school sends, with the same effects as finalizing. The evidence upload is required.
  - FOA rounds open only in FOA_JUDGING, which §6 allows only once every school round is FINALIZED, so no entry reaches SUBMITTED_TO_FOA during FOA_JUDGING.
- **E6. Entry withdrawn during or after judging (§7.5):** its RoundEntry → WITHDRAWN and, while it is IN_JUDGING, its sheets → VOID. If results are already published, a correction follows as in E3.
- **E7. Artwork damaged or a DISCREPANCY found after the round opens:** the CM may `excludeRoundEntry` with a reason. The entry ends ELIMINATED / PARTICIPANT.
- **E8. Data changes between approval and `publishAt`:** a stale hash makes the job REJECT the release (`STALE`), and the CM re-proposes. Consent is applied at render time, so consent changes never make a release stale.
- **E9. Wrong name on a certificate:** after §6 fixes the profile, `reissueCertificate` issues a new number, and the old one verifies as REVOKED ("Replaced by a reissued certificate").
- **E10. Logo changes after publishing:** handled by `stamp.restamp_all`. Old public objects remain for 7 days, so shared links keep working until OG images refresh.

### 7.16 Acceptance Criteria

1. Weights 30/25/25/20 (max 10) with scores 8/6/7/10 give `weightedTotal = 76.50`. A total sent by the client is ignored.
2. Editing a rubric used by an OPEN round fails. Publishing v2 leaves RoundEntries pinned to v1.
3. `finalizeSchoolRound` rejects duplicate positions, more than N advanced, a positioned row that isn't advanced (when P ≤ N), and a missing certification. A valid grid under ALL leaves entries SCHOOL_SHORTLISTED or NOT_SHORTLISTED with `schoolRank` and `schoolAwardLabel` set.
4. SHORTLIST_ONLY: 40 participated registrations, 0 entries, 3 positions and 5 advanced give 40 PARTICIPATION and 3 SCHOOL_MERIT certificates and one `schoolShortlist.finalized` with 5 shortlisted and 35 not-shortlisted IDs, with 0 entry transitions.
5. Snapshot tests show judge-route responses contain no `fullName`, `displayName`, `dateOfBirth`, institution, city, `registrationNumber` or `participantCode`.
6. A judge with a COI on institution X gets no sheet for X's entries. `openRound` fails, naming entries, if that leaves an entry under the minimum.
7. With `requiresPhysicalVerified`, an entry whose artwork is DISPATCHED stays FOA_VERIFIED and is listed as Blocked. Entries in the pool move to IN_JUDGING.
8. Sheets of 70, 80 and 90 give `meanScore 80.00`. Under Z_SCORE, a judge with fewer than 5 sheets contributes raw totals.
9. Two entries still tied at the cutoff after the chain block `lockRound`. Resolving with SHARE advances both.
10. Editing a SUBMITTED sheet while OPEN writes a `ScoreSheetRevision`. Any edit after SCORING_CLOSED fails.
11. Finalizing the final round sets `finalOutcome` for every entry that entered FOA judging, per §7.4.4, and moves the competition to RESULTS_PENDING_APPROVAL.
12. `approveResults` fails for the proposer and for a CM. It succeeds for a different SA.
13. Before `publishAt`: no outcome on any participant or public page, no FINALIST-or-higher certificate rows, no `results.published`. All of them exist within 1 minute after.
14. The results page shows the §12.7 public name only with PUBLIC_DISPLAY consent (a minor without `showFullName` appears as "Aarav S."; with no consent, "{entryCode} · Name withheld"). It never shows city, age or DOB.
15. Every certificate number matches `^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$` and is unique. The QR decodes to `{APP_URL}/verify/{number}`.
16. `/verify` shows REVOKED for revoked and superseded certificates. Unknown, PENDING and FAILED numbers give identical 404s. A minor's page without consent shows no school, city or DOB.
17. Reissue gives a new number and marks the old one SUPERSEDED. The school's bulk ZIP holds exactly the GENERATED certificates for its registrations.
18. Repeating `stamp()` with the same settings returns the same FileAsset. A logo change yields a new hash, and the restamp job updates every PUBLISHED item. Outputs carry no EXIF/GPS, and a pixel test finds the logo in the configured corner.
19. A crawl of public routes finds every `<img>` and `og:image` is a STAMPED public asset. `toPublicImageUrl` throws for ORIGINAL and WEB.
20. Gallery approval fails without PUBLIC_DISPLAY consent, without an APPROVED ModerationReview, or with `allowPublicDisplay = false`. After a withdrawal, the detail page returns 410 within 15 minutes and the objects are deleted within 24 hours (target 15 minutes). A minor's item never appears in `sitemap.xml`.
21. Gallery filters, and search by title or display name, return the right items. An item toggle set to false, or a §12.7 pref left off, hides institution or city on the page and in meta tags.
22. `createSocialExport` fails without SOCIAL_MEDIA or PUBLIC_DISPLAY consent, and `markSocialExportReady` fails if the acknowledgement line is removed. Withdrawing consent after posting sets LIVE records to TAKEDOWN_REQUIRED, due in 72 hours.
23. DQ after publishing: certificates are revoked at once. A PROMOTE_NEXT correction, approved by a second person, moves 2nd to 1st with new certificates and cancels the DQ'd entry's PENDING prize.
24. Unit tests cover every allowed and disallowed transition of the FOA round, the school round, §7's EntryStatus transitions, ResultsRelease, Certificate, PrizeFulfilment, GalleryItem and SocialPostRecord.

### 7.17 Open Questions (this section)

| # | Question the source leaves open | Default applied |
|---|---|---|
| Q1 | A/B grades vs gold/silver/bronze vs 1/2/3 | Configurable per round. Default: RANKED "All India 1st/2nd/3rd" in the final round (1st = WINNER, 2nd–3rd = RUNNER_UP) |
| Q2 | Are school-level rubric scores mandatory? | No. Positions and shortlist only |
| Q3 | Top 3 or top 5 school positions; prescribed N | 3 positions; N = 5 per category per school |
| Q4 | Which FOA levels are active | One round: NATIONAL, final, PHYSICAL. CITY/STATE/GLOBAL added as needed |
| Q5 | "Individuals judged on the physical copy" | `requiresPhysicalVerified = true` on every FOA round. Individuals go straight into the first FOA round (no school round, no school merit) |
| Q6 | Judges per entry, distribution, normalization | 3 judges; each panel judge scores the whole category (ALL); no normalization |
| Q7 | Tie-break rules | Criterion means by weight → median → manual. Share at the cutoff; order at award edges |
| Q8 | Who gives "final approval" | CM or SA proposes; a *different* SA approves |
| Q9 | Name printed on certificates | Full name on the private PDF; display name on `/verify`, share images and public pages |
| Q10 | Who counts as a "finalist"; intermediate-level awards | Every entry that reaches the final round. Non-final award bands off by default |
| Q11 | Do judges' comments reach participants? | Off by default. When on, moderated and anonymized |
| Q12 | Watermarking video | MVP: STAMPED poster plus a player logo overlay. Burned-in ffmpeg watermark after MVP |
| Q13 | Are eliminations disclosed before results? | No. Participants see "In FOA judging" until PUBLISHED |
| Q14 | Takedown SLAs | Taken from §12.6: pages 15 minutes; CDN target 15 minutes, limit 24 hours; social (manual) 72 hours |
| Q15 | A school that misses its deadline | No automatic forfeit. FOA closes it on the school's behalf (participation only, or staff-entered) |
| Q16 | Gallery "city/country where appropriate" | §12.7 defaults (state and country; city and school only by opt-in). The moderator's item toggles can hide them further |
| Q17 | Certificates for ineligible, withdrawn or absent students | Not issued |
