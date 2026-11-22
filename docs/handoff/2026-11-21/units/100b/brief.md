# Brief 100b: public certificate verification and QR target (issue #100, M4)

| | |
|---|---|
| Blocked by | 100a (certificate table, statuses, `domain/number.ts`). Also needs on its milestone: #82 public-credit resolver, #57/#58 Postgres rate limiter, #65 CSP |
| Size, flags | M · risk (A: public lookup endpoint; K: minors' names on a public page; C: public dynamic page under CSP) |
| Keys | none; touches `src/lib/routes.ts`/`robots.ts` only if needed (H3-style append; `/verify` is already disallowed in `robots.ts`) |
| Branch | `ticket/100-verify` → PR into `M4`, title `M4 #100: Certificates with QR verification (verify)` |
| Head start | none here: the stand-alone part (normalising numbers, the verify path) lives in 100a's `domain/number.ts`, already built |

## Scope
In (100b): use case `verifyCertificate({ number })` for any actor (visitor included); the rate limit (30 lookups/min per client
IP, hashed key); the public view model; pages `/verify` (number form, plain GET, works without JS) and `/verify/[number]`
(valid / revoked / replaced / unknown); `verify` messages namespace; noindex; Seam 2 spec.
- **100a owns:** the table, numbers, `normaliseCertificateNumber`, `verifyPathFor`, and the `verifyUrl` put in the PDF data.
- **100c owns:** drawing the QR from `verifyUrl` and proving it decodes (jsqr).
- **#101 owns:** revoke/reissue use cases and the M4 journey. 100b already renders `revoked` and `superseded` (the enum exists),
  with status only: no reason text (it may hold personal data). Deviation from "wired by #101": recorded, reversible.

## Acceptance criteria (numbered, with seam)
1. **Valid** (S1). For an issued certificate, `as(h.visitor()).verifyCertificate({ number })` → `{ outcome: "valid", number,
   type, awardPosition | awardLabel, competition: { code, name }, year, issuedOn, credit }` where `credit` is the live public
   credit (#82): minor default "Asha K.", adult per consent, "Name withheld" without public-display consent.
2. **Unknown** (S1). An unknown well-formed number and a malformed string both → `{ outcome: "unknown" }` (one shape, no hint
   which). Empty input → `unknown`, no DB read.
3. **Normalise** (S1 + unit in 100a ✔). Lower case, surrounding/inner spaces, `O` for `0` and `I`/`L` for `1` in the code part,
   missing hyphens → the same valid result. `U` anywhere in the code part → unknown.
4. **Revoked / replaced** (S1). A row with status `revoked` → `{ outcome: "revoked", number, competition, year }` (no credit, no
   reason); `superseded` → `{ outcome: "superseded", number }`.
5. **No PII** (S1). The serialised result never contains DOB, age, city, school (unless the credit resolver allows it),
   guardian data, registration number, entry code, email, phone, `name_snapshot` or a file key. Test serialises and greps.
6. **QR target** (S1). The `verifyUrl` 100a gives the renderer (`h.pdf.rendered[0].data.verifyUrl`) → take its path, run the
   page's param handling (`normaliseCertificateNumber(decodeURIComponent(segment))`) → `verifyCertificate` → `valid`.
7. **Rate limit** (S1). 30 lookups in a minute from one IP pass; the 31st → `{ outcome: "rate_limited", retryAfterSeconds }`;
   another IP passes; after `h.clock.advance({ minutes: 1 })` the first passes again. Unknown numbers count too.
8. **Authz** (S1). Visitor, participant and staff all pass (public by design); the authorization test asserts the rule is
   `public` in the `can()` table and a `system` actor gets no extra fields.
9. **Pages** (S2, written, Not run). `/verify`, `/verify/<valid>`, `/verify/<unknown>`, `/verify/<revoked>` each pass
   `expectRendersAccessibly` + one `.dark` run; `<meta name="robots" content="noindex">`; the form works with JS disabled
   (`javaScriptEnabled: false` context submits to `/verify/<number>`). No horizontal scroll at 320 px.

## Files
New: `src/server/modules/certificates/verify.ts` + `verify.test.ts`, `src/app/verify/{page.tsx,[number]/page.tsx,
lookup/route.ts,_components/*,_lib/*}`, `messages/en-IN/verify.json`, `tests/e2e/100-verify.spec.ts`.
Touch: `src/server/modules/certificates/index.ts` (one use case), `src/i18n/messages.ts` (H3), the `can()` table (H8), `src/lib/routes.ts`
public registry + sitemap exclusion check (keep `/verify` out of the sitemap), CSP sources only through #65's API.
Read first: `node_modules/next/dist/docs/01-app/` for dynamic segments under Cache Components (traps 2–8, 15), `connection()`,
`headers()`, metadata `robots`.

## Design
- **A. One use case returning a closed union ← chosen.** `verifyCertificate({ number }) → VerifyResult` with `outcome` in
  `valid | revoked | superseded | unknown | rate_limited`. The page only switches on `outcome`; normalising, the rate limit, the
  lookup, credit resolution and the PII allow-list all sit behind one call (leverage; one test file covers ACs 1–8).
- **B. Page reads the table + resolver itself.** Spreads the PII rule into a Server Component Vitest can't render (trap 14).
  Rejected.
- Page shape: `/verify/[number]` is dynamic: the param read and `headers()` (IP for the limiter) sit inside `<Suspense>`; no
  `generateStaticParams`. `/verify` stays fully static: its plain `<form method="get" action="/verify/lookup">` posts
  `?number=` to a route handler `src/app/verify/lookup/route.ts` that answers 303 to `/verify/<normalised>` (or
  `/verify/<raw, encoded>` when malformed, which renders "unknown"). Static `lookup` wins over `[number]`, and "LOOKUP" can never
  be a certificate number. Works without JS. Confirm segment precedence in the docs before coding.
- IP: from the actor's `meta.ip` (#57b `actorFromRequest`); limiter key `verify:` + sha256(ip + `RATE_LIMIT_PEPPER` if #58
  provides one) so raw IPs are never stored.

## Interface needs (code against these; adopt real names at claim)
```ts
// 100a
certificate: PgTable<{ id; number; type; status: "issued" | "revoked" | "superseded"; competitionId; participantProfileId;
  awardPosition: number | null; awardLabel: string | null; issuedAt: Date }>;
normaliseCertificateNumber(input: string): string | null; verifyPathFor(number: string): string;
// #82 consent: public credit, live (never stored)
publicCredit(db: AppDb, i: { participantProfileId: string; competitionId: string }): Promise<{ name: string | null; school:
  string | null; city: string | null }>;   // name null = "Name withheld"
// #57b/#58 rate limiter (Postgres)
consumeRateLimit(db: AppDb, clock: Clock, i: { key: string; limit: number; windowSeconds: number }):
  Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
// #59a: can(ctx, "certificates.verify") with rule { public: true }
```

## Residue
HR-44 (safeguarding sign-off of what the verify page shows for minors) · HR-30 (DPDP: minors' public credit) · HR-46 (YY meaning).

## Test plan
Seam 1: `verify.test.ts` (ACs 1–8) on `createHarness` with 100a's seed builders (`h.seed.issuedCertificate({ minor, consent })`),
the fake clock for the limiter. Unit: normalisation is covered in 100a's `domain/number.test.ts`. Seam 2: `tests/e2e/100-verify.spec.ts`
written, Not run (no Postgres here; previews fail at `db:migrate`).

## Slices (ordered)
1. **Verify end to end** (size M = 1 slice): use case + limiter + view model, then pages + messages + e2e spec. ACs 1–9.
   Test file `src/server/modules/certificates/verify.test.ts`.
