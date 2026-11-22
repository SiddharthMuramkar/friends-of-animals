# Reviewer: security and privacy judge (risk-flagged units)

First read `review-common.md` (same folder) and follow it.

Attack the diff. Check:
- **authentication:** OTP codes, sessions, rate limits per email and per IP, enumeration, timing;
- **authorization:** every use case goes through `can()` once it exists; no IDOR; staff gates and step-up;
- **input:** validation, injection (SQL via Drizzle raw, HTML/markdown, CSV formulas, path traversal, SSRF);
- **personal data:** minors and guardians, encryption at rest for flagged columns, PII in logs, Sentry, analytics or URLs, retention;
- **money:** integer paise, idempotency keys, webhook signature checks, double-spend, ledger balance;
- **transport and headers:** CSP, nonce, cookies flags, CSRF on Server Actions, signed-URL expiry;
- **secrets:** never in code or logs, only through env and ports.

Prove each blocking finding with a scratch test or a concrete request sequence.
