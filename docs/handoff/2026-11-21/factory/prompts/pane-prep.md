# Pane: head start for one issue (phase A)

You are pane `foa-p<issue>`. Read `rules.md` (same folder) first. Your input is in the launch message.

This issue's code mostly depends on tickets that haven't landed yet, so this phase does everything that **doesn't** depend on them. The orchestrator later starts a build pane per unit that picks up your work.

## 1. Learn the house style
The Seam-1 harness every unit builds on is PR #140 (branch `ticket/57-harness`, unit 57a, under review). It may still change.
- Run `git -C /root/friends-of-animals fetch -q foa`.
- Read its key files: `git -C /root/friends-of-animals show foa/ticket/57-harness:<path>` for `src/server/app.ts`, `src/server/deps.ts`, `src/server/ports/*`, `src/test/harness.ts`, `src/test/fakes/*`, `src/server/seed/*` and `src/components/form/*`. List the files with `git ls-tree -r --name-only foa/ticket/57-harness src/server src/test`.
- Also read spec §1.2 (directory map) and §1.9.

## 2. Brief each unit
For **each** unit in your input, write `/root/foa-work/units/<unit>/brief.md` exactly as `prep.md` steps 2–5 describe:
- scope, with which sibling owns what;
- numbered testable ACs, each with its seam;
- files to touch, and hotspots;
- the chosen design (compare 2–3 designs with `codebase-design` when the unit is risk-flagged or adds a module or port);
- residue, with HR ids;
- the test plan;
- ordered slices.

Also note **interface needs**: what this unit expects from its blockers (tables, use cases, ports, events). Make each one a concrete TypeScript signature you'll code against.

## 3. Pure-core head start (only where it truly stands alone)
If a unit has domain logic that needs nothing unbuilt, build it now, test-first with plain Vitest unit tests. Examples: money and fee arithmetic, state machines and transition tables, validation and parsing (CSV, phone, IDs), scoring and ranking, scheduling and deadline rules, distance maths, formatting, slug and ID schemes.
- Worktree: `git -C /root/friends-of-animals worktree add -b <branch> <worktree> foa/M0`, then `cd <worktree> && pnpm install --frozen-lockfile --offline`.
- **New files only**, under the module folder the brief names, for example `src/server/modules/<module>/domain/`. No schema, migrations, routes, pages, Server Actions, proxy, layout, registries or any hotspot file (spec §1.10), and no new dependencies.
- Gate: `/root/foa-work/factory/tools/gate.sh pnpm check` (rules.md Gates; run it in the background) must pass, and `git status --porcelain` must be clean. Commit as `M<k> #<issue>: Add <thing> domain core` and push the branch. Don't open a PR.
- Skip this step when there is no stand-alone core. Don't stretch to find one.

Time box: about 45 minutes for the whole issue.

## 4. Report, then stop
Run exactly:
`hc send t18 "PREPPED #<issue> units=<id,id> code=<unit:shortsha,...|none> residue=<count> note=<at most 12 words>"`

After that, do nothing more and wait. The orchestrator closes this pane. If you're stuck: `hc send t18 "BLOCKED #<issue> <reason>"`.
