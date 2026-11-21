# Unit 83a: guardian consent by code link (#83, M1)

Branch `ticket/83-code-link`, worktree `/root/foa-wt/83a`, base `foa/M0` today (rebase onto `foa/M1` at build). L, risk
`A K C` (unauthenticated token flow, minors, nonce CSP on a public dynamic page). Blockers 63a, 65, 82 (and through 82:
81b, 81a, 78, 77a, 75b, 74, 72, 69, 64). Sibling **83b** (signed forms) runs in parallel.
Phase A on the branch: `e10af73 M1 #83: Add consent-link domain core` (pure, 44 tests, see "Built in phase A").

## Scope
**In (83a):** a coordinator sends each school-route student's guardian a single-use link per competition (email; SMS
once `sms.enabled`), resends (old link revoked) or withdraws it. The guardian opens `/consent/[token]` with no account,
asks for a one-time code to the contact on the link, enters it, and within 30 minutes gives or declines **each public
use the competition offers**. Gives become consent events (method `otp_link`, labelled "code link"), declines withdraw
a given consent. The link is then used up; it also expires after 7 days. Coordinator dashboard
`/institution/registrations/[ref]/consents`: per student, the link state and the public-use summary. Inventory rows,
seed, `guardianConsent` + `coordinatorConsents` namespaces, nonce CSP + `noindex` + `no-referrer` on the token page.
**Out (83b owns):** signed-form upload, the FOA review queue, accept/reject with reviewer, the public-use gate
(`decideSchoolRouteUse` inside #82's `canUse`, AC3), the participation declaration, the "Signed form" column.
**Out (others):** guardian accounts (#81), consents given from a guardian account (#82), printable form (HR-33), claiming a
school profile into a guardian account (later).

## Acceptance checks (seam)
1. **Send.** `as(coordinatorOfX).sendConsentLink({ registrationId, studentId, channel: "email", address })` → link
   `pending`, `expiresAt = now + 7 d`, one audit `consent_link.sent`; after `h.drain()` one email to the address with a
   `/consent/<43-char token>` link. Resend revokes the earlier pending link (its token → `revoked`) and the new one works.
   Raw SQL shows no plaintext token or address (#58 ciphertext + blind index). `channel: "sms"` → `sms_disabled` while
   `sms.enabled` is false. Student not in the registration → `not_found`; nothing offered → `nothing_offered`. **S1**
2. **Open.** `as(visitor).viewConsentLink({ token })` → `{ status, childFirstName, competitionTitle, institutionName,
   maskedContact, uses: [{ purpose, documentId, version, title }] }` while open; once used, revoked or expired only
   `{ status }` (no child data). Malformed or unknown token → `not_found`, no lookup detail leaked. GET never changes
   state (mail scanners prefetch links). **S1**
3. **Code.** `sendConsentLinkCode({ token })` → one code to the link's contact by direct send (not the outbox);
   `wait` with `retryAt` inside 60 s; `too_many_codes` after 5; per-IP `rate_limited` (57b limiter, 10/hour).
   `verifyConsentLinkCode({ token, code })` → `{ ok, sessionToken, answerBy }`; `wrong_code` with `attemptsLeft`;
   `code_locked` after 5; `code_expired` at +10 min (fake clock); a spent code can't verify twice. **S1**
4. **Answer.** `answerConsentLink({ token, sessionToken, answers })` with `public_display: give, social_media: decline`
   → one `given` event: subject the student's profile, competition, document version shown, method `otp_link`, giver
   `guardian_contact` (contact hash + link id), time from the clock; no event for the decline (nothing was given);
   a decline of a use given earlier → `withdrawn` event + #82's `consent.withdrawn` outbox row. Link `used`, answers
   stored on it, audit `consent_link.answered`. Missing, extra or invalid answers → refusal, nothing written. **S1**
5. **Single use and expiry.** Second answer → `already_used`; any step on a used link → `already_used`; at
   `clock.advance({ days: 7 })` view/code/answer → `expired`; answer at verify + 30 min → `window_closed`; answer
   with no or another link's `sessionToken` (forwarded link) → `not_verified`. **S1**
6. **Dashboard state.** `listStudentConsents({ registrationId })` → per student `{ studentId, name, link:
   not_sent|sent|opened|verified|answered|expired|revoked, publicUse: none|some|all, given[], canSendLink }`;
   states move as ACs 1–5 run. **S1**
7. **Authorization, every new use case.** send/revoke/list: coordinator or authorised person of the student's
   institution passes; coordinator of another institution, a guardian, a member and a visitor → `forbidden`, nothing
   written. Bearer use cases (view, code, verify, answer): a valid token passes for a visitor and a signed-in user;
   another link's token or session → `not_found` / `not_verified`. **S1**
8. **Inventory** rows (below), each with purpose and `retention: { period, basis, toConfirm: true }`. **Vitest**
9. **Seed**: the seeded school registration has students with an answered link (gave display, declined social), a
   pending link and an expired one; seeding twice changes nothing. **S1**
10. **Pages, axe light + dark:** dashboard (states, send dialog, errors), `/consent/[token]` (start, code entry,
    answer, done, expired, used). Token page: nonce CSP (65's dynamic rule), `noindex`, `Referrer-Policy:
    no-referrer`, `Cache-Control: no-store`. **S2** `tests/e2e/83-code-link-consent.spec.ts`, written, **Not run**.

## Files
- **New:** `src/server/modules/consent-links/domain/*` (**done**); `consent-links/{index,send-link,public-link,
  dashboard,repository}.ts` + tests; `src/server/db/schema/consent-links.ts`; migration `83_consent_links`;
  `src/server/seed/consent-links.ts`; `src/app/consent/[token]/{page.tsx,_components/*,actions.ts}`;
  `src/app/institution/registrations/[ref]/consents/{page.tsx,_components/*,actions.ts}`;
  `messages/en-IN/{guardianConsent,coordinatorConsents}.json`; `tests/e2e/83-code-link-consent.spec.ts`.
- **Touch, one line or entry each:** `app.ts`, schema barrel, `seed/index.ts`, `src/i18n/messages.ts`, `app-routes.ts`,
  the `can()` table, #69's map seed (template `guardian_consent_link`), `src/server/privacy/inventory.ts`.
- **Hotspots:** #82's consent event table: add `giver_contact_hash`, `consent_link_id` (FK) and make `giver_user_id`
  nullable. 83b makes the **identical** nullable edit (git merges identical hunks), its other columns are disjoint;
  regenerate SQL in the merge queue. `src/proxy.ts` (X2) only if 65 picks nonce routes by matcher (add `/consent/:token`).
  Dashboard page: 83b adds its column after this lands (or this adds it if 83b landed first). Not in `routes.ts`/sitemap.

## Design
Compared (codebase-design): **(a) token + one-time code to the contact on the link, then a 30-minute answer session
(chosen)**; (b) token only with a short expiry and "type the last 4 digits of your phone"; (c) magic sign-in that
creates a light guardian account. (b) proves nothing a forwarded or scanned link doesn't; (c) collides with #81's
verified-guardian model and makes an account per school parent (against "no account needed" and DPDP minimisation).
(a) gives a deep module: 7 use cases over one pure core (`domain/link.ts` decides every step with refusal precedence
used > revoked > expired; codes, attempts and session live on the link row, so no extra table and no job). The code
proves control of the contact at answer time; the session secret (74's `createLinkToken`, stored hashed, httpOnly
`SameSite=Strict` cookie scoped to `/consent/<token>`, 30 min) stops a forwarded link answering. Expired is derived
from `expires_at`. Link code: 6 digits, link-salted SHA-256, constant-time compare (`domain/one-time-code.ts`), not
57b's sign-in OTP (no account to sign in). Table `consent_link`: id, participant_profile_id, competition_id,
institution_registration_id, channel `consent_link_channel` (email|sms), contact_ciphertext, contact_hash,
token_hash unique, token_ciphertext (nulled when closed, read at send time like #74), status `consent_link_status`
(pending|used|revoked), sent_by_user_id, sent_at, expires_at, codes_sent, last_code_sent_at, code_hash,
code_expires_at, code_attempts, verified_at, session_token_hash, used_at, revoked_at, answers jsonb, timestamps;
partial unique `(participant_profile_id, competition_id) WHERE status = 'pending'`.
Defaults (write in the PR): contact entered by the coordinator, pre-filled from 75b's guardian contact if it exists;
offered uses = #82's public uses the competition attaches documents for; a new link may follow an answer so a
no-account guardian can change or withdraw; link TTL 7 d, code 10 min, 5 tries, 5 codes, 60 s cooldown.

**Interface needs (code against these; rename to what landed):**
```ts
// 74
createLinkToken(): { token: string; tokenHash: string }; hashLinkToken(t: string): string; isWellFormedLinkToken(v: string): boolean;
maskIdentifier(channel: "email" | "phone", value: string): string;
// 58
encryptedText(): PgCustomColumn<string>; blindIndex(normalised: string): string; normalisePhoneNumber(raw: string): string | null;
settings.get("sms.enabled"): Promise<boolean>; deps.sms.send(m: { to: string; text: string; dltTemplateId: string }): Promise<void>;
// 75a/75b
institutionRegistration: { id; ref; institutionId; competitionId }; participantProfile: { id; ownerKind: "institution"; firstName; lastName };
registrationStudents(db: AppDb, registrationId: string): Promise<{ profileId: string; firstName: string; lastName: string }[]>;
studentGuardianContact?(db: AppDb, profileId: string): Promise<{ channel: "email" | "phone"; address: string } | null>;
// 59a
can(ctx, action: "consent_link.send" | "consent_link.revoke" | "consent_link.list", r: { type: "institution"; id: string }): Promise<boolean>;
writeAudit(tx, ctx, e: { action: string; entityType: "consent_link"; entityId: string; before: unknown; after: unknown }): Promise<void>;
// 57b
rateLimit(ctx, key: string, rule: { max: number; windowMs: number }): Promise<{ ok: true } | { ok: false; retryAt: Date }>;
// 61a / 69
emit(tx, e: { type: "consent.link_sent"; aggregateType: "consent_link"; aggregateId: string; payload: { linkId: string } }): Promise<void>;
// 82
offeredPublicUses(db, competitionId: string): Promise<{ purpose: PublicUse; documentId: string; version: number; title: string }[]>;
currentConsents(db, s: { subjectType: "participant_profile"; subjectId: string; competitionId: string }): Promise<Record<string, ConsentState>>;
recordConsentEvent(tx, ctx, e: { subject: { type: "participant_profile"; id: string }; competitionId: string; purpose: string;
  documentId: string; action: "given" | "withdrawn"; method: "otp_link";
  giver: { kind: "guardian_contact"; contactHash: string; consentLinkId: string } }): Promise<{ id: string }>; // emits consent.withdrawn
```

## Residue
HR-30 (code link to a school-held contact as verifiable parental consent); HR-14 (SMS link needs a DLT template with
the URL whitelisted; email works meanwhile); HR-32 (safeguarding sign-off of the code-link flow; gates the M1
release PR, not this merge); HR-31 (retention below); HR-33 append (draft link message copy); HR-05 inherited.
Inventory: `consent_link.contact_ciphertext` + `contact_hash` (send link and code; 90 days after the link closes),
`consent_link.answers` (record of what was answered; with the consent record), `consent_event.giver_contact_hash`
(who consented; life of the consent + 3 years). All `toConfirm`.

## Test plan
Pure (**done**): `link.test.ts`, `one-time-code.test.ts`, `answers.test.ts`, `student-status.test.ts`. Seam 1 on
`createHarness()` with the email fake, #58 SMS fake, drain, fake clock, 75b/82 seed builders; one file per slice.
Seam 2 written, Not run (no Postgres here).

## Slices
1. **Send, resend, withdraw** (ACs 1, 7). Schema, migration, `sendConsentLink`, `revokeConsentLink`, map row.
   Test `src/server/modules/consent-links/send-link.test.ts`.
2. **Open and verify by code** (2, 3, 5, 7). `viewConsentLink`, `sendConsentLinkCode`, `verifyConsentLinkCode`.
   Test `consent-links/verify-link.test.ts`.
3. **Answer, single use, expiry** (4, 5, 7). `answerConsentLink`, consent event columns.
   Test `consent-links/answer-link.test.ts`.
4. **Dashboard read, seed, inventory** (6, 8, 9). `listStudentConsents`. Test `consent-links/dashboard.test.ts` +
   `src/server/seed/consent-links.test.ts`.
5. **Pages, namespaces, headers, Seam 2** (10). Test `tests/e2e/83-code-link-consent.spec.ts`.

## Built in phase A (e10af73, pushed, no PR)
`src/server/modules/consent-links/domain/`: `link.ts` (`linkExpiresAt`, `closedReason`, `linkStatus`,
`decideSendCode`, `decideVerifyCode`, `decideAnswer`, `decideRevoke`, TTL constants; decisions return the row
patch to store), `one-time-code.ts` (`createOneTimeCode`, `normaliseOneTimeCode`, `hashOneTimeCode`,
`oneTimeCodeMatches`), `answers.ts` (`checkAnswers`), `student-status.ts` (`studentConsentStatus`).
