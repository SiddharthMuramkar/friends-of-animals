# Unit 65: Content Security Policy for public and signed-in pages

Issue #65 · M0 · size L · risk (CSP, auth) · keys X2 X3 X4 · blocker **57b** · branch `ticket/65-content-security-policy-for-public` · worktree `/root/foa-wt/65` · base 442dd99
Head start pushed: **0561aaa** `src/lib/csp.ts` and `src/lib/csp-report.ts` with tests (27 cases; `pnpm check` green). No siblings: this unit owns the whole ticket.

## Scope
- **In:** CSP only (#50 already sends HSTS, XFO, referrer and the rest):
  - public static policy through the one `headers()`;
  - signed-in nonce policy in `src/proxy.ts`;
  - `/api/csp-report` plus the `Reporting-Endpoints` header;
  - build-output checks;
  - Seam 2 header and violation checks.
- **Out:** rate limiting by IP (no IP kept, by design); storing reports in the DB (they are logged; #66 gives log retention); Sentry, R2, Razorpay and Umami sources (63a, 66a, 77b and 118 add one `CspSources` entry each).
- **Who owns what:** 57b owns `SIGNED_IN_PREFIXES`, the signed-in layout and its proxy logic, and the sign-in journey. 57c owns `/account/sessions`. 66a and 63a also edit `next.config.ts`.

## Acceptance criteria (testable)
1. **Public pages:** every page has a CSP with no nonce and is still prerendered.
   - Unit: `publicCsp` never has `nonce-` or `'strict-dynamic'` (done).
   - Build: `check:build` fails if a public route from `src/lib/routes.ts` is missing from `.next/prerender-manifest.json` (stays ○ or ◐).
   - Seam 2: `/` carries the header without a nonce.
2. **Signed-in pages:** a strict nonce policy.
   - Unit: `script-src 'self' 'nonce-…' 'strict-dynamic' 'sha256-<theme>'`, with no `'unsafe-inline'` in script-src (done).
   - Proxy unit test: a fresh nonce per request, the same value on the request and response headers, and only for `SIGNED_IN_PREFIXES`.
   - Seam 2: the signed-in page's header has a nonce, and every `<script>` in its HTML has `nonce=` or is the hashed theme script.
3. **No violations during smoke and sign-in:**
   - Seam 2: `tests/e2e/support/csp.ts` records `securitypolicyviolation` events (both dispositions) and CSP console messages. It must record 0 across the smoke routes and 57b's sign-in journey.
   - The staging run is residue (HR-27).
4. **Inline scripts and handlers removed or moved:**
   - The theme script stays inline. It is allowed by `'unsafe-inline'` on public pages and by its sha256 hash on signed-in pages, so **`src/app/layout.tsx` needs no edit**. X3 may be droppable; the orchestrator decides.
   - JSON-LD is a data block, not subject to `script-src`.
   - Build: prerendered HTML has no `on<event>=` attributes and no `javascript:` URLs (`script-src-attr 'none'` enforces this at runtime).
5. **Reports collected without personal data:**
   - Unit (done): both content types parse; query, fragment, sample, referrer, user agent and original policy are dropped; 16 KiB cap gives 413; wrong type gives 415; at most 20 per batch; budget per instance.
   - Route unit test: 204, one scrubbed JSON log line per violation, nothing logged over budget.
6. **Header tests on one public and one signed-in page:** unit tests on `csp.ts` (done), plus Playwright header checks in `tests/e2e/65-content-security-policy.spec.ts`.

## Design (risk-flagged: three ways compared, one picked)
- **Static-page strategy:**
  - **A (chosen):** `'self' 'unsafe-inline'` plus `script-src-attr 'none'`.
  - **B, rejected:** post-build per-page hashes. `headers()` is evaluated before prerender, and ◐ pages stream request-time inline scripts whose hashes can't be known.
  - **C, rejected:** `experimental.sri` with `'strict-dynamic'`. SRI covers external files only, and `'strict-dynamic'` switches `'unsafe-inline'` off, so Next's inline `self.__next_f.push` scripts would be blocked.
  - Source: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` ("Without Nonces", SRI limits). `script-src-attr` works on Safari ≥ 15.4, inside the iOS 16 floor.
- **Module shape:**
  - **D1, rejected:** template strings per area (the Next docs style). Shallow; every feature edits strings.
  - **D3, rejected:** a fluent builder class. More interface for no extra leverage.
  - **D2 (chosen, built):** a deep module with a small interface: `publicCsp(ctx)`, `signedInCsp(ctx, nonce)`, `createNonce()`, `reportingEndpoints()`, `cspMode(appEnv)`, and `CspSources` for features (https/wss origins only).
  - It hides mode rules: report-only on staging and production (HR-19), enforced locally and on previews, and `frame-ancestors` and `upgrade-insecure-requests` only when enforced (browsers ignore them in report-only and warn in the console).
  - It also hides the dev-only `'unsafe-eval'` and the theme hash.
  - Relative imports only, because `next.config.ts` loads it under plain Node.
- **Signed-in rendering, the open risk:**
  - Next 16.4's resume path (`build/templates/app-page-runtime.js` ~l.1252) stamps the request nonce only on the Turbopack bootstrap. A Cache Components static shell keeps its build-time scripts without a nonce, so the signed-in tree must have **no shell**.
  - **Slice 3 starts with a spike:** 57b's signed-in layout does `await connection()` at the top with no Suspense above it. Then `pnpm build`: the route must be ƒ with no `.html`. Then `next start` and `curl -H 'cookie: …'`: every `<script` must have a nonce.
  - If the build refuses (blocking-prerender error), try `instant = false` on that layout (`03-api-reference/03-file-conventions/02-route-segment-config/instant.md`). If that also fails, send `BLOCKED` with the build output; don't weaken the policy.
- **One policy per response:** the `headers()` CSP entry's `source` excludes `SIGNED_IN_PREFIXES` (path-to-regexp negative lookahead). Proof: unit test of the generated source, plus Seam 2 asserting exactly one CSP header on the signed-in page.
- **The report route skips `as(actor)`:** it touches no domain state, needs no actor and has no `can()` (59a). It is edge plumbing: zod-parsed (`parseCspReport`), with no DB and `Cache-Control: no-store`. This deviation from the thin-edge rule is stated in the PR.

## Interface needs (what 65 codes against)
```ts
// 57b, src/lib/routes.ts (or app-routes.ts): the signed-in tree roots
export const SIGNED_IN_PREFIXES: readonly `/${string}`[]; // e.g. ["/account"]
// 57b: a signed-in page rendered per request, e.g. "/account" (57c: "/account/sessions")
// 57b, src/proxy.ts: `export function proxy(request: NextRequest): NextResponse` + `config.matcher`;
//   65 adds `if (isSignedInPath(pathname)) return withNonceCsp(request, next)` and matcher entries
//   `{ source: "/account/:path*", missing: [next-router-prefetch, purpose=prefetch] }`
// 57b, tests/e2e/support/: `signIn(page: Page, email: string): Promise<void>` (capture-mailbox code)
// 66a later: `CspSources` entry `{ feature: "error tracking", directives: { "connect-src": [<ingest>] } }`
```

## Files
- **Done:** `src/lib/csp.ts`, `src/lib/csp-report.ts`, and their tests.
- **To touch:**
  - `next.config.ts` and `src/lib/security-headers.ts` plus its test (X4): the comment "CSP tracked in #15"; keep XFO, because `frame-ancestors` is ignored while report-only.
  - `src/proxy.ts` and a new `src/proxy.test.ts` (X2).
  - New `src/app/api/csp-report/route.ts` and its test.
  - New `src/lib/csp-sources.ts`: the feature list, which 63a, 66a, 77b and 118 append to.
  - New `scripts/csp-output.ts` and its test; a two-line call in `scripts/check-build.ts`.
  - New `tests/e2e/65-content-security-policy.spec.ts` and `tests/e2e/support/csp.ts`.
- **Hotspot notes:**
  - Merge after 66a (both edit `next.config.ts`) and before 58 and 60 (X2).
  - Rebase onto 57b's proxy; don't rewrite its slug or redirect logic.
  - Vercel preview toolbar: Seam 2 sends `x-vercel-skip-toolbar: 1` (check the Vercel docs). If people use the toolbar on previews, add a preview-only `CspSources` entry for `vercel.live`, checked against Vercel's CSP guidance.

## Residue
- **HR-19:** Report-Only on staging for N days, then flip `cspMode` to enforce. The owner picks N; it's a one-line change.
- **HR-27:** after M0 → main, confirm no CSP violations on staging during the smoke and sign-in journeys (reports land in Vercel logs).
- **Not run here (no Postgres, no Chromium):**
  - the Seam 2 spec and the `next start` signed-in curl. Run them locally on port 3100 once 57b's DB-backed sign-in works, or on the preview after the owner sets `BETTER_AUTH_SECRET` and `CAPTURE_MAILBOX_TOKEN`.

## Test plan
- **Unit:**
  - `csp.test.ts` (done), plus a `cspRouteHeaders` / source-pattern test;
  - `csp-report.test.ts` (done);
  - `proxy.test.ts` (`new NextRequest`; nonce freshness, headers, matcher paths);
  - `route.test.ts` (POST bodies, status codes, the logged line has no PII; `vi.spyOn(console, "warn")`).
- **Build:**
  - `scripts/csp-output.test.ts` on fixture HTML and manifests;
  - the real gate: `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build`, with the route table compared to M0's (every public route still ○ or ◐).
- **Seam 2:** `65-content-security-policy.spec.ts` covers the `/` header, the signed-in header and nonce attributes, and zero violations across the smoke routes and the sign-in journey. No new pages, so no axe additions; the existing smoke reruns.

## Slices (ordered; each is one behaviour and one test file)
1. **Public header on every public route.**
   - Add `cspRouteHeaders(ctx, SIGNED_IN_PREFIXES)` to csp.ts and wire it into `headers()` with `Reporting-Endpoints`.
   - Update the security-headers comment and test.
   - Test: `src/lib/csp.test.ts` (source pattern, entries). Gate: build plus a `curl -sI` on `next start`.
2. **Build output stays static and handler-free.** `scripts/csp-output.ts` (prerendered public routes, no `on*=` attributes, no `javascript:`), called from `check-build.ts`. Test: `scripts/csp-output.test.ts`.
3. **Report endpoint.** `src/app/api/csp-report/route.ts` uses `parseCspReport` and `createReportBudget(limit 100/min)`, logs one `csp.violation` JSON line each, and returns 204, 413, 415 or 400. Test: `src/app/api/csp-report/route.test.ts`.
4. **Signed-in nonce policy.** Spike first (see Design), then the proxy nonce plus the matcher. Test: `src/proxy.test.ts`. Gate: the build shows the signed-in route as ƒ, and curl shows nonces on every script.
5. **Seam 2 checks.** `tests/e2e/support/csp.ts` and `tests/e2e/65-content-security-policy.spec.ts`, wired into the smoke and sign-in journeys. These are not run here.
