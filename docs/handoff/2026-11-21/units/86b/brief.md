# Brief 86b: Essay entries and the single rich-text sanitiser

Unit 86b · issue #86 · M2 · size M · risk A (XSS) PD · keys none · blocked by 85b · branch `ticket/86-essay-sanitiser` ·
worktree `/root/foa-wt/86b` · base `442dd99` (foa/M0). Sibling **86a** owns video. Owner ruling on #86 (2026-11-19, binding):
**a typed essay goes straight to `submitted`; replacing an essay can switch between text and document.**

## Scope
- **In:** the ESSAY discipline on 85b's entries pipeline.
  - The participant either types the essay (a plain `<textarea>`) or uploads a PDF.
  - Typed text is normalised, word-counted and limited to 1500 words. It is converted to paragraphs, passed through **the
    platform's one rich-text sanitiser** and stored as `entry_file.text_html` (kind `text`, `live` at once).
  - A PDF goes through 63b's scan gate like any file, and then live.
  - Replacement switches text ↔ document freely.
  - Also in: `src/server/rich-text/` with the `essay` profile (#111 adds `cms`; F4), the XSS corpus, the `<RichText>` render
    component, lint guards, the seed essay entries and the axe spec.
- **Out:** the Entry ID, deadline, receipt, submitter policy and status tables' existing rows (all **85b**). Video (**86a**).
  Coordinator submit (**87**, inherited). Stripping PDF author metadata before judges see it belongs to **#96** (blind judging,
  M3; F10). Nobody but FOA staff and the family sees an essay in M2, so recording it as a follow-up loses nothing. DOCX waits for
  Gotenberg (#100).

## Acceptance checks (Seam 1 unless stated)
1. **Typed essay → `submitted` at once.** `as(participant).saveEssayText({ registrationId, title, text })` inside the window creates
   the entry with an Entry ID code. The status is `submitted` (one `entry_transition` row null → `submitted`, trigger
   `essay_saved`), with one `live` file of kind `text` and `word_count`. `entry.submitted` is emitted, and draining sends 85b's
   receipt. No file asset and no scan.
2. **Typed text is sanitised.** `text_html` equals `sanitizeRichText(essayTextToHtml(normalised), "essay")`. Typed `<script>…`,
   `<img onerror>` or `javascript:` arrive as visible, escaped text, never markup. The corpus test (unit) feeds the sanitiser raw HTML
   directly: script, event handlers, `javascript:`/`data:`/`vbscript:` URLs (encoded and mixed case), `<svg onload>`, `<math>`,
   `<iframe>`, `<object>`, `<style>`, `style=expression()`, `<template>`/`<noscript>` mXSS strings, `<base>`, `<meta refresh>`,
   `<form>`, unclosed and nested tags, entity-encoded variants. The output has no element outside the profile and no attribute at
   all. Sanitising is idempotent: `s(s(x)) === s(x)`. Allowed `<p>` and `<br>` survive.
3. **Word limit, both sides.** 1501 words is refused with `too_many_words` (no rows). An empty or whitespace-only essay is refused
   with `empty`. The form's live counter uses the same `countWords`. **Built:** `countWords` and `checkEssayText`.
4. **Essay as a PDF.** `startEntryUpload` with `application/pdf` for ESSAY (types: PDF only; at most 10 MB), then complete → entry
   `processing`. Drain with clean → `submitted`. EICAR → `rejected`, with retry offered. A non-PDF type → `wrong_type`. PNG bytes
   declared PDF → `rejected` (63b's sniff).
5. **Switch on replace** (owner).
   - A `submitted` text essay replaced by a PDF: the text stays live until the PDF is live, then the text is `superseded`.
   - A `submitted` PDF essay replaced by text: the text goes live at once, and the PDF and any in-flight upload are `superseded`.
   - Text replaced by text: the new one is live and the old one superseded, in one transaction (the partial unique "one live file"
     holds).
   - The entry stays `submitted` through every replacement and emits `entry.replacement_live`.
6. **Typed retry after a bad document.** An entry `rejected` (infected PDF) or `failed`, retried with typed text, goes
   `rejected → processing → submitted` in one transaction (two transition rows). 85b's table forbids `rejected → submitted` and
   stays unchanged. `processing → submitted` with a still-scanning first PDF supersedes the PDF.
7. **Deadline.** With `clock.set(submissionClosesAt)`, `saveEssayText` and a document replacement are refused with
   `deadline_passed`. Before `submissionOpensAt`, the refusal is `submission_not_open` (85b's `decideUpload`).
8. **Authz.** `saveEssayText` and the essay branch of `getEntry`: the participant and the guardian of the ward pass. Another
   participant, a member, a visitor, a coordinator on the individual route and a competition manager get `forbidden`. A competition
   manager may read a `submitted` essay through `getEntry` (85b's staff rule).
9. **Rendering.** `getEntry` returns `essay: { kind: "text"; html } | { kind: "document"; url }`. Pages render HTML only through
   `<RichText html>`, which sanitises again. Lint: `react/no-danger` errors everywhere except `src/components/rich-text.tsx`, and
   `no-restricted-imports` bans the hast packages outside `src/server/rich-text/`.
10. **axe** (Seam 2, written, **Not run**). `tests/e2e/86-essay.spec.ts`: the essay form (text and document tabs) and a seeded text
   essay's detail page, `expectRendersAccessibly` in both themes.

## Files
- **Built (head start):** `src/server/modules/entries/domain/essay-text.ts` + test (`normaliseEssayText`, `countWords`,
  `essayTextToHtml`, `checkEssayText`, `DEFAULT_ESSAY_RULE`).
- **New:**
  - `src/server/rich-text/{sanitize.ts,profiles.ts,sanitize.test.ts,xss-corpus.ts}` (server-only);
  - `src/components/rich-text.tsx` (server component);
  - `src/server/modules/entries/use-cases/save-essay-text.ts`;
  - `src/app/dashboard/entries/_components/essay-entry-form.tsx` (client island, labels prop);
  - `messages/en-IN/entriesEssay.json`;
  - `tests/e2e/86-essay.spec.ts`.
- **Hotspots:**
  - **H22:** two rows in 85b's `ENTRY_MOVES`: `null → submitted` and `processing → submitted` with trigger `essay_saved`. Plus
    `pending|processing → superseded` and `live → superseded` file moves on `text_saved` (`null → live` for a text file).
  - **H23:** an ESSAY rule in `upload-rules.ts` (`application/pdf`, 10 MB). `entries/index.ts` gets one use-case line.
  - **H26:** the new-entry and detail pages pick the essay form or `<RichText>`.
  - 85b's `entry_file` needs `text_html text null` and `word_count int null` (85b's proposed schema has `text_html`). If 85b left
    them out, 86b adds them in its own generated migration `86_essay_text` (no enum change). The purpose `entry_document` is added
    via `--custom 86_pre_enum_entry_document` only if 85b didn't.
  - **H29:** `package.json` + lockfile: `hast-util-from-html`, `hast-util-sanitize`, `hast-util-to-html` (exact pins, ≥ 24 h old).
  - `.oxlintrc.json`: two overrides (shared config: serialize with any open lint change).
  - **H3:** one namespace. **H6:** seed a text essay and a PDF essay.
  - Merge order Q2: 85b → 87 → 86a → 86b.

## Design (risk-flagged; codebase-design vocabulary)
**Sanitiser.** One function, `sanitizeRichText(html: string, profile: "essay"): string`, is the whole interface. Profiles are data.
- **S1 (chosen): hast pipeline.** `fromHtml(html, { fragment: true })` → `sanitize(tree, schema)` → `toHtml(tree)`.
  - parse5 is a spec-compliant HTML parser, the same tree-building algorithm browsers use. That removes the parser-differential
    (mXSS) class that a sanitiser's own parser invites.
  - The schema is a plain allowlist object (`essay`: `p`, `br`, no attributes, `strip: ["script","style",...]`). #111's `cms`
    extends it by spreading, never forking.
  - No DOM, no jsdom, runs in Node and the worker.
  - Deep: one call hides parsing, allowlisting, URL protocol checks, clobber prefixes and serialisation.
- **S2: `sanitize-html` allowlist.** One dependency. But htmlparser2 isn't spec-compliant, so the output can re-parse differently
  in a browser (mXSS history), and it pulls in postcss for styles.
- **S3: DOMPurify + jsdom on the server.** The best browser fidelity, but jsdom is heavy on Vercel functions and in the worker, and
  it adds a second runtime DOM to maintain. Rejected.

The tournament judges run the shared corpus (`xss-corpus.ts`) against S1 and S2. Defaults otherwise: sanitise on write (stored) and
again at render in `<RichText>` (cheap and idempotent, and a later profile tightening covers old rows).

**Essay input.**
- **E1 (chosen): plain textarea → paragraphs.** Blank lines make `<p>`, single newlines make `<br>`, everything is escaped, then
  sanitised. No editor JS (the 170 kB budget), simple a11y, kid-friendly, and nothing a participant types can become markup.
- **E2: minimal rich-text editor** (bold, italic, lists). It adds a contenteditable island, paste-cleaning and more sanitiser
  surface for little judging value. A follow-up if FOA asks.
- **E3: a Markdown subset.** Hidden syntax that kids won't know. Rejected.

Normalisation: NFC, CRLF → LF, control characters and bidi overrides (U+202A–U+202E, U+2066–U+2069) removed, at most one blank
line kept, joiners (U+200C/U+200D) kept for Indian scripts. Words are whitespace-separated runs with a letter or digit, the way
word processors count, so a participant's own count matches. This works for Hindi, Tamil and the other spaced scripts. A
20,000-character cap guards the 1 MB Server Action. **Built:** `574bc5b`.

## Interface needs (code against these; adapt names at claim)
```ts
// 85b (ticket/85-* domain core): ENTRY_MOVES / ENTRY_FILE_MOVES tables, canMoveEntry, moveEntry, moveEntryFile,
// decideUpload({ entry, window, now }) -> { ok, action: "create"|"retry"|"replace", supersede } | { ok:false, reason }
// windowState(window, now); checkUpload(file, rule); UploadRule; EntrySnapshot
resolveEntrySubmitter(ctx: UseCaseContext, registrationId: string): Promise<{ kind: "participant" | "guardian" | "coordinator"; registration: RegistrationForEntry }>;
newEntryCode(tx: AppDb, competitionId: string): Promise<string>;           // via #73 Codes, `{comp}-E-{6}`
recordEntryTransition(tx: AppDb, i: { entryId: string; from: EntryStatus | null; to: EntryStatus; trigger: EntryTrigger; actor: Actor; at: Date }): Promise<void>;
entryFile table: { id; entryId; fileAssetId: string | null; kind: "image"|"video"|"document"|"text"; textHtml: string | null; wordCount: number | null; status: EntryFileStatus; ... }
getEntry(i: { code: string }): Promise<EntryDetail>; // 86b adds `essay`
// 61a: emit(tx, clock, { type: "entry.submitted" | "entry.replacement_live", aggregate: { type: "entry", id }, payload: { entryId } })
// 63a: PURPOSE_RULES.entry_document = { contentTypes: ["application/pdf"], maxBytes: 10 MiB }; getFileDownloadUrl(...)
// #59: can(actor, "entry.submit", { registrationId }) through 85b's policy
```

## Residue
- **HR-37:** the 1500-word limit, PDF only, and 10 MB.
- **HR-36:** the essay form copy and the receipt wording.
- **HR-31:** retention for typed essay text and PDFs.
- **Follow-up for #96:** judges must see a PDF essay with its author metadata removed (F10).

## Test plan
- **Unit:** `essay-text.test.ts` (built) and `src/server/rich-text/sanitize.test.ts` (corpus, idempotence, allowed formatting
  survives).
- **Seam 1:** `src/server/modules/entries/essay.test.ts` (ACs 1–9). The authz part is table-driven.
- **Seam 2:** `tests/e2e/86-essay.spec.ts`, Not run (no Postgres).

## Slices (M → 1)
1. **Essay typed or as a PDF, sanitised, switchable until the deadline** (ACs 1–10). Proved by `src/server/modules/entries/essay.test.ts`.
   The sanitiser's own corpus sits beside it in `src/server/rich-text/sanitize.test.ts`. Build order inside the slice: sanitiser
   and corpus → `saveEssayText` → document rule → replacement switching → render and lint → pages, seed and axe.
