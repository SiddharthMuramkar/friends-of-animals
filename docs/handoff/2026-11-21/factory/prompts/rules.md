# foa-factory: rules for every agent

You are one agent in the **foa-factory**. It turns the 79 open tickets of spec #55 (#57–#135, milestones M0–M8) in GitHub repo `siddhartxts/friends-of-animals` into merged code, as fast as the dependency graph allows.
- The owner asked for it on 2026-11-21 and watches the panes.
- The orchestrator is the Claude session in hc terminal **t18**. It schedules, reviews with independent agents and merges.
- Never ask questions: build the reversible default, write it down, and keep going.
- A **pane** agent (an hc terminal) reports to the orchestrator with `hc send t18 "<message>"`, exactly in the formats its prompt gives.
- A **Workflow stage** agent returns data for a script, not a message to a person.

## Places
- Main checkout: `/root/friends-of-animals`, git remote **`foa`**. Never `git checkout` or `git switch` in it; other sessions use it. Create worktrees from it with `git -C /root/friends-of-animals worktree add …`.
- Unit worktrees: `/root/foa-wt/<unit>` (for example `/root/foa-wt/59a`). foa-57's own worktree is `/root/foa-wt/57`: never touch it.
- Factory files: `/root/foa-work/factory/`. Unit notes: `/root/foa-work/units/<unit>/`. Older briefs: `/root/foa-work/briefs/<issue>.md`.
- Integration branches: `M0` … `M8` (milestone k = "trunk" for its units). `main` and `production` belong to the owner.

## Sources, in this order of authority
Ticket body plus owner comments (`gh issue view <n> --comments`); #55's decision comments (`gh issue view 55 --comments`), which override ticket bodies; `docs/specs/issue-factory-spec.md` §1 (ground truth, conventions, Next.js traps §1.7, UI rules §1.8, DB and migration rules §1.9, hotspots §1.10, settled decisions §1.11) and §10 (implementation rules); `docs/specs/issue-factory/issues-M*.md` (your ticket's part: dependencies, residue, test plan, hotspots); `docs/specs/issue-factory/code-server.md` (DB, migrations, harness; §10 = migration-number conflicts); existing code. On `M0` these live in the repo. In an older checkout, read them with `git show foa/M0:<path>`. Read `node_modules/next/dist/docs/` before writing any route, auth, proxy or caching code. This Next.js has breaking changes from what you remember.

## Method
- Test-first at Seam 1: `as(actor).<useCase>(input)` on PGlite with real migrations, the fake clock and provider fakes (`src/test/harness.ts`, `src/test/fakes/*`, once 57a has landed). Use the `tdd` skill when you write code. Seam 2 (Playwright in `tests/e2e/<issue>-<slug>.spec.ts`, with `expectRendersAccessibly` on every new page) is written but can't run here: there's no Postgres server, and Vercel previews fail at `pnpm db:migrate`. List those runs under "Not run".
- Never weaken a test: no `.skip`, `.only`, `fixme` or `todo`, no retries, no quarantine, no deleted assertions, no axe narrowing.
- Exact dependency pins (`saveExact`), no ranges. Don't install system packages. Node 24 here vs 26 pinned: pnpm only warns, so carry on.
- Migrations: `DIRECT_URL=postgres://foa:foa@localhost:5432/foa pnpm db:generate --name <issue>_<slug> </dev/null` (it doesn't connect). Never edit a migration that already exists on any `M<k>`. Never use an enum value in DDL in the same migration that adds it.
- Need a secret, a provider account, legal copy or a human decision? Build the default behind the port, fake, capture adapter or flag. Record it as residue (`HR-NN` from `docs/specs/issue-factory/residue.md` where one fits) and keep going. Never block on it.

## Gates (exact commands, in the unit worktree)
1. `/root/foa-work/factory/tools/gate.sh pnpm check` (typecheck, lint, format check, Vitest)
2. `/root/foa-work/factory/tools/gate.sh bash -c 'DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build'`. The variables must be empty, not unset.
3. `git status --porcelain` prints nothing.

`gate.sh` runs the command as usual, but first waits for one of 4 CPU slots shared by every agent here, and applies `VITEST_MAX_WORKERS=2 nice -n 10`. About 30 agents share this 8-CPU box. Without the queue, load went past 60 and PGlite tests timed out at random. Waiting for a slot can take minutes, so run gate commands with the Bash tool's `run_in_background` and wait for the notification. Never run full `pnpm check`, `pnpm test`, `vitest run` or `pnpm build` outside `gate.sh`. A targeted run of one or a few test files may skip the queue, but prefix it with `VITEST_MAX_WORKERS=2 nice -n 10`. If a test times out, rerun it once alone before treating it as a real failure. Never raise a timeout to hide load.

## Git and GitHub conventions
- Commit subject `M<k> #<issue>: <Imperative subject>`: sentence case, at most 80 characters, no trailing period. Body wrapped at 72. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push only your unit's `ticket/<issue>-<slug>` branch, with `git push -u foa <branch>`. Force-push only that branch, and only with `--force-with-lease`.
- PR title `M<k> #<issue>: <unit title>`. Base `M<k>`. The body is written with the `pr` skill. Its first line is `Refs #<issue>. Lands in M<k>.` It has `## Residue` and a "Not run:" list, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Every GitHub comment you post ends with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## NEVER
- Push to, merge into, force-push or delete `main` or `production`. Open a PR whose base is `main`. Rewrite any `M<k>` history.
- Merge a PR, push or create an `M<k>` branch, close or label an issue. **Only the merge and cut stages may do these, and only as their prompts say.**
- Run docker. Read any `.env*` file except `.env.example`. Connect to any database that isn't local. Hold or print a secret.
- Edit `.claude/skills/`, `skills-lock.json`, #55's body or `.github/workflows/` on `main`.
- Start subagents, Workflows or hc terminals. Do skill steps that would fan out yourself, in this context.
- Touch another unit's worktree or branch.

If you can't finish, stop cleanly. Commit and push what's green, and return `ok: false` with the exact blocker in `summary`.
