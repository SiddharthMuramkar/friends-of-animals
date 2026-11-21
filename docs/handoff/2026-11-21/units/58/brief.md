# Unit 58: Sign in by phone one-time code (#58, M0)

Branch `ticket/58-sign-in-by-phone-one` · worktree `/root/foa-wt/58` · base `foa/M0` 442dd99 · blocked by **57b** · keys X1 X2 · risk · L.
Head start pushed: `06776cd M0 #58: Add phone, field cipher and blind index domain core` (new files only, 57 tests). The build pane
merges `foa/M0` once 57b has landed, then builds the slices below. Older brief: `/root/foa-work/briefs/58.md` (this one overrides it).

## Scope
In: phone sign-up and sign-in by SMS code, next to email; the SMS port (MSG91 for production, capture everywhere else, in-memory fake);
the `sms.enabled` switch; an encrypted phone column plus a blind index for lookup; per-phone and per-IP limits; a user holding email and
phone signs in with either; the seed gets a user with a phone; the UI method switch and the SMS-off notice.
Out: adding or changing a phone on an existing account (a follow-up, `needs-triage`; M0 has no account settings page); WhatsApp;
international numbers (only Indian mobiles, others get pointed to email); the settings table and screen (#62); outbox/welcome event (#61).
Siblings: none. 57b owns Better Auth config, OTP codes, limiter, sign-in/up pages, `auth` namespace; 57c owns `/account/sessions`.

## Acceptance checks (seam: S1 = `h.as(actor).<useCase>` on PGlite via `createHarness()`; U = plain Vitest; S2 = Playwright, written, not run here)
1. SMS on: `as(visitor).requestPhoneCode({ phone: "+91 98765 43210" })` leaves one SMS in `h.sms.lastTo("+919876543210")` with a
   6-digit code; `verifyPhoneCode({ phone, code })` creates a user and starts a session (same result shape as `verifyEmailCode`);
   repeating with a new code returns the same user id. (S1)
2. SMS off (`sms.enabled` false): `requestPhoneCode` throws `DomainError` `sms_disabled`; `h.sms.sent` stays empty, no code row,
   no limiter hit; `signInMethods()` returns `{ email: true, phone: false }`; `/sign-in` and `/sign-up` show "codes come by email"
   with a link to email sign-in. (S1; page state S2 + axe)
3. Encrypted at rest: raw `select * from "user"` contains neither `+919876543210` nor `9876543210`; `phone_hash` is
   `blindIndex.of("user.phone", e164)`; sign-in finds the user through it; `+91 98765 43210`, `098765 43210`, `9876543210` reach one
   user; a value written under key v1 still reads after v2 is added. (S1; rotation and non-disclosure already U in 06776cd)
4. Limits: the 6th request for one phone within 15 min fails `rate_limited` with `retryAfter`, and `h.sms.sent` has exactly 5; the 21st
   request from one IP across phones and email together is refused; after `h.clock.advance({ minutes: 15 })` it is allowed. (S1)
5. No real SMS outside production: `smsSenderFor("local"|"preview"|"staging")` writes `captured_message` rows with `channel='sms'`;
   `"production"` uses MSG91 when its keys are set, else `unconfiguredSmsSender`, which refuses (mirrors `emailSenderFor`). The MSG91
   adapter takes an injected `fetch`; no test touches the network. (S1 + contract)
6. Coverage: phone sign-up, sign-in, both limits, SMS off, wrong/expired code and too many attempts on the phone channel, all at S1
   with `h.sms` and the fake clock; `pnpm test` green. (evidence)
7. Seed: `seedPreview` twice leaves exactly one user with phone `+91 90000 00101` (member1, Asha Rao), stored encrypted; with SMS on
   that user signs in by phone at S1, and by email, with the same user id. (S1)
8. Authorization: each new use case has an allow and a deny test (a signed-in user asking for a sign-in code is refused as 57b refuses
   it for email); errors and logs never contain the number. (S1)

## Files
New: `src/lib/phone.ts` ✓, `src/server/crypto/{field-cipher,blind-index}.ts` ✓ (+tests); `src/server/crypto/keys.ts` (env → cipher,
dev key ring for local/preview); `src/server/db/types/encrypted-text.ts`; `src/server/ports/{sms,sms-capture,sms-msg91}.ts`,
`sms.contract.ts`; `src/test/fakes/sms.ts`; phone use cases in 57b's identity folder (`phone-sign-in.ts` + tests);
`drizzle/NNNN_58_phone.sql` (+ a separate migration if the limiter scope is an enum); `messages/en-IN/authPhone.json`; phone route
`_components`; `tests/e2e/58-sign-in-by-phone-one.spec.ts`.
Touch (hotspots): X1 `src/server/deps.ts` (+`sms`, `cipher`, `blindIndex`, `settings` if #62 hasn't landed), `src/test/harness.ts`
(+`h.sms`, settings override); `schema/identity.ts` + `drizzle/meta/*`; `src/server/seed/{identity,accounts,types}.ts`,
`scripts/seed.ts`; `src/env.schema.ts`, `.env.example`; `src/i18n/messages.ts`; 57b's route registry and sign-in/up pages; X2
`src/proxy.ts` only if 57b's matcher names auth routes; `tests/e2e/support/accounts.ts`; `GLOSSARY.md` (Blind index, Field cipher,
via `domain-modeling`). Merge after 61a (X1) and 65 (X2), rebasing onto each.

## Design
Encrypted column, two options: (A) a Drizzle `customType` that encrypts in `toDriver` with a module-level key ring. Shallow
safety: hides keys from callers but reads env at import, can't take the harness's keys, and `eq(user.phone, x)` silently never matches
(random IV). (B) **Chosen:** keys are deps (`ctx.cipher`, `ctx.blindIndex`, built once in `productionDeps()`, fresh random keys in
the harness); `encryptedText()` is a branded column type whose data type is `Ciphertext`, so only `cipher.encrypt()` output type-checks
into it, and lookups go through `phone_hash` (unique, partial where not null). Columns: `phone_ciphertext encryptedText`,
`phone_hash text`, `phone_verified boolean not null default false`. M1 reuses (B) for DOB, address, guardian contact, PAN.
OTP flow, three options: (a) BA `phoneNumber` plugin with the blind index in `phoneNumber`: the plugin passes that column to
`sendOTP`, so the raw number needs a request-scoped side channel, and phone-only users need temp emails: rejected. (b) a custom
FOA BA plugin: logic sits behind BA endpoints, so Seam 1 can't reach it through `as(actor)`, and it couples to BA internals:
rejected. (c) **Chosen:** FOA use cases `requestPhoneCode`, `verifyPhoneCode`, `signInMethods` in the identity module, reusing 57b's
code store, limiter, session start and `DomainError`. Deep: two calls hide parse → hash → switch → limits → code → send →
find-or-create → session; the SMS port is a real seam (MSG91, capture, fake). Email column: default **nullable** (`ALTER COLUMN email
DROP NOT NULL`) so a phone-only user is honest; if BA session reads break on a null email, fall back to `phone-<userId>@phone.invalid`
with `emailVerified=false` and a `hasRealEmail()` guard on every send. Record which in the PR.
Switch: `ctx.settings.get("sms.enabled")` (#62's catalogue key, default `false`). The seed stores `true` on local/preview (codes go to
the capture mailbox, so the S2 phone journey can run); staging and production keep `false`, so staging shows the SMS-off notice.
Keys: `FIELD_ENCRYPTION_KEYS` = `"<version>:<base64 32 B>,…"` (highest encrypts), `FIELD_HMAC_KEY` = base64 32 B. Required on staging and
production (envSchema refinement); local/preview fall back to committed, obviously fake `DEV_*` keys (seed data only). MSG91 keys
optional everywhere (send refuses without them), so production still starts before DLT.

## Interface needs (58 codes against these; rename to what 57b ships, build any missing piece inside the identity module)
```ts
type SignInChannel = "email" | "sms";
// 57b one-time codes, keyed by a hashed identifier; the plain code only comes back to be sent.
issueSignInCode(ctx: UseCaseContext, to: { channel: SignInChannel; key: string }): Promise<{ code: string; expiresAt: Date }>;
checkSignInCode(ctx: UseCaseContext, to: { channel: SignInChannel; key: string }, code: string):
  Promise<"ok" | "invalid_code" | "code_expired" | "too_many_attempts">;
// 57b Postgres limiter; 58 adds scope "phone" and shares "ip" with email.
hitRateLimit(ctx: UseCaseContext, rule: { scope: "email" | "phone" | "ip"; key: string; max: number; windowMs: number }):
  Promise<{ ok: true } | { ok: false; retryAfter: Date }>;
// 57b: what verifyEmailCode does after a good code, and user creation (#61 hooks its welcome event here).
startSession(ctx: UseCaseContext, userId: string): Promise<SignedIn>;
createUser(tx: AppDb, clock: Clock, input: { name: string; email: string | null;
  phone?: { ciphertext: Ciphertext; hash: string } }): Promise<User>;
class DomainError extends Error { code: "rate_limited" | "invalid_code" | "code_expired" | "too_many_attempts" | "forbidden" | "sms_disabled"; retryAfter?: Date }
// #62 (or 58's stub until it lands), on Deps:
interface Settings { get<K extends SettingKey>(key: K): Promise<SettingValue<K>> }
// 58 adds to Deps: sms: SmsSender; cipher: FieldCipher; blindIndex: BlindIndex; SeedDeps gains cipher + blindIndex.
interface SmsSender { send(message: { to: E164Phone; text: string; template: "sign-in-code"; vars: Record<string, string> }): Promise<void> }
```
If 57b keeps codes in BA's `verification` table, 58 writes its rows with drizzle (identifier `sms:<phone_hash>`), never the plain number.

## Residue
- HR-05: `FIELD_ENCRYPTION_KEYS` (`1:$(openssl rand -base64 32)`) and `FIELD_HMAC_KEY` (`openssl rand -base64 32`) in Vercel Preview,
  staging, Production; offline backup (lost key = lost phones); rotation: add v2, re-encrypt, drop v1; HMAC key change = re-hash job.
  Staging won't start without them, so M0 → main waits on HR-05.
- HR-14: DLT via MSG91 (header, OTP template text with its variable, `dlt_template_id`), `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`,
  `MSG91_OTP_TEMPLATE_ID` in Production; then flip `sms.enabled`. Template copy is a placeholder until then.
- HR-19 (append): per-phone 5 codes / 15 min, per-IP 20 / 15 min shared with email; Indian mobiles only at launch.
- HR-31 (append): retention period for `user.phone`.

## Test plan
U (done): phone parsing (formats, refusals, other countries), cipher (round trip, no plain digits, fresh IV, rotation, tamper, wrong
column, unknown version, key-ring errors), blind index (stable known answer from openssl, keyed, purpose-separated). Contract:
`sms.contract.ts` run by the fake and the capture adapter on PGlite. S1: ACs 1–8 above. Deps matrix: `smsSenderFor` per `APP_ENV`;
env schema: staging/production without field keys rejected, local/preview fall back. Render test for the SMS-off notice and phone form
(`renderToStaticMarkup`). S2 (Not run: no Postgres, previews fail at `db:migrate`): phone sign-up through the capture mailbox, sign
out, sign in by phone; seeded member1 signs in by phone; `expectRendersAccessibly` on `/sign-in` and `/sign-up` phone views, light and dark.

## Slices (each one test file, in order)
1. Encrypted phone at rest: migration + `encryptedText()` + deps/harness/env keys + seed member1 phone → ACs 3 (storage), 7 (seed
   half). `src/server/seed/phone.test.ts` (S1, raw SQL).
2. SMS port: port, capture, fake, contract, MSG91 adapter, `smsSenderFor` → AC 5. `src/server/ports/sms.test.ts` (+ contract in fake/capture tests).
3. Phone sign-up and sign-in, SMS on: `requestPhoneCode`, `verifyPhoneCode`, spellings, both channels same user, wrong/expired/attempts,
   authz → ACs 1, 3 (lookup), 7, 8. `<identity>/phone-sign-in.test.ts` (S1).
4. SMS off and limits: `sms_disabled`, `signInMethods`, per-phone and shared per-IP limits, window rollover → ACs 2 (S1), 4.
   `<identity>/phone-limits.test.ts` (S1).
5. UI and journey: method link on 57b's pages, phone code form, SMS-off notice, `authPhone` namespace, route registry → ACs 1, 2 (UI).
   `tests/e2e/58-sign-in-by-phone-one.spec.ts` (S2, not run) + `_components/*.test.tsx`.
