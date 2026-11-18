# ADR-0002: The platform stack is not chosen yet

- Status: Pending
- Date: 2026-11-18

## Context

Three descriptions exist, and they disagree:

- The running starter is React Router 8, Drizzle, and Postgres (ADR-0001).
- `specifications/` section 2 still says Next.js, Prisma, and Neon. Issue #10 left that section alone on purpose, so it would be updated when the stack was locked.
- Research tickets #2 through #6 recommended Next.js 16, Drizzle, Better Auth, Cloudflare R2, a worker on a Mumbai server, and Postgres on that server. Those notes are on the `research/*` branches, not on `main`. Issue #1 lists them under "Decisions so far" as the research answers. The grilling ticket that was supposed to lock the choice with the owner is still open.

Issue #11 ("Lock the platform stack and hosting layout") is open and has no comments. The owner has not signed off.

## Decision

None. This record exists so agents do not treat a research recommendation, or the spec's original stack, as the choice.

## Consequences

- Do not start a migration to Next.js, Prisma, Neon, or a VPS database as if #11 were closed.
- Do not rewrite `specifications/` section 2 until the owner answers #11.
- Feature work on the current code stays on the starter in ADR-0001.
- When the owner answers, update this ADR to Accepted, name the choice, and point at the issue comment that records it.
