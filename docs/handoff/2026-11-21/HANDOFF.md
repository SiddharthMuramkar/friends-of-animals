# Handoff: foa-factory paused on 2026-11-21

The owner paused all work on spec #55 (79 tickets, #57–#135, milestones M0–M8), because GitHub billing is blocking Actions and the repo is about to be transferred to another account. Every agent was stopped and every piece of work is pushed to GitHub. This file says where things stand and how to restart.

## What was running

- One orchestrator session (hc terminal t18) ran the **foa-factory**: hc panes on the server, one per issue or unit, plus cold-review Workflows.
- The plan it followed is §1–§14 of `docs/specs/issue-factory-spec.md`. The 119-unit build order is `docs/specs/issue-factory/dag.md`.
- The factory's own files are copied into this folder: `factory/` holds `units.json`, `state.json`, `factory.py`, `tools/`, `prompts/` and `review.js`. `units/<unit>/brief.md` holds the prep briefs.
- Rules the factory followed (in `factory/prompts/rules.md`):
  - Agents merge ticket PRs only into `M0`…`M8`.
  - The owner alone merges `M<k>` → `main`.
  - An issue closes when its last unit lands on `M<k>`.
  - Gates are run locally, because CI can't run while billing is blocked.

## State at pause

Unit states are in `factory/state.json`. Run `python3 -I factory/factory.py board` to see them.

| | |
|---|---|
| Merged into M0 | #67 only |
| Issues prepped (brief written, stand-alone domain code pushed on the ticket branch) | 56 |
| Prep interrupted (WIP commits pushed, marked "not gated") | #66 #86 #103 #108 #110 #112 #115 #126 #128 #130 #132 #133 #135 |
| Not started | #68 #90 #98 #101 #104 #113 #116 #118 #120 |

Branches with commits marked `WIP paused by the orchestrator, not gated`:
- the interrupted prep units: 66a, 86a, 110a, 112a, 115a, 115b, 132, 133a, 133b, 135a;
- 57a (PR #140).

### The critical path: #57, three stacked PRs

The whole graph waits on 57a, the Seam 1 test harness. No other unit can build until it merges into `M0`.

- **#140 `ticket/57-harness` → M0 (57a).**
  - Round 1 review failed with 4 blocking findings, listed in `units/57a/review-r1.md`.
  - The fix pane committed all four fixes before the pause:
    - `a76c316`: migrate the PGlite template once per run;
    - `b91aefd`: seed in `vercel-build`;
    - `49fd624`: migrations fingerprint in preview DB names;
    - `8505d95`: `.gitattributes` union for the barrels.
  - It also committed 4 minor fixes, plus a WIP test tweak in `8a99f88`.
  - **Next:**
    1. Run the gates on the tip and finish or drop `8a99f88`.
    2. Run a round-2 review.
    3. Merge into M0.
- **#141 `ticket/57-email-otp` → `ticket/57-harness` (57b, sign-in by email code).**
  - It has 555 tests passing.
  - Its round-1 review was started and then stopped by the pause, so it has no verdict.
  - Retarget it to M0 after #140 merges.
- **#142 `ticket/57-sessions` → `ticket/57-email-otp` (57c, the sessions list).** Same treatment: retarget it once #141 merges.

Other open PRs: #136 (M0 → main, the milestone PR), #138 and #139 (into main, the owner's).

## Restarting after the transfer

1. **Point the clone at the new repo:** `git remote set-url foa <new url>` in the main checkout.
2. **Replace the repo slug** `siddhartxts/friends-of-animals` in `factory/prompts/rules.md`, `pr.md` and `pane-merge.md`.
3. **Restore the factory files.** They lived in `/root/foa-work/factory/` and `/root/foa-work/units/` on the server, which still has them. On a new machine, copy this folder's `factory/` and `units/` back to those paths, or change the paths in `factory/tools/launch.py`, `factory/factory.py`, `factory/review.js` and the prompts.
4. **Reset the interrupted prep issues** so they get relaunched:
   ```sh
   python3 -I factory.py set '#N' todo
   ```
   A new prep pane has to continue from the existing ticket branch and its WIP commit, not start over.
5. **Lift the GitHub Actions billing lock on the new account.** Then CI runs on every PR. Until it is lifted, the merge bar is the local gates.
6. **Re-check after the transfer:** the Vercel Git connection, Actions secrets and variables, and branch protection.
   - GitHub keeps issues, PRs, branches and their numbers when a repo is transferred.
7. **Resume the loop:**
   - The orchestrator steps are in `factory/prompts/pane-*.md`, with the review Workflow in `factory/review.js`.
   - Commands: `factory.py ready`, then `tools/launch.py build <unit>` for each ready unit, then review, then a `MERGE` job to the merge pane.
   - `docs/specs/issue-factory-spec.md` §13 describes the merge and cascade steps.

## Lessons from this run

- **CPU, not memory, is the limit on an 8-CPU box.**
  - About 30 agents running uncapped Vitest pushed load to 70, and PGlite tests timed out at random.
  - `factory/tools/gate.sh` queues every full `pnpm check` or build for one of 4 shared slots, with `VITEST_MAX_WORKERS=2`.
  - Keep that, and run about 15–20 prep panes, not 30.
- **Prep briefs found missing edges and conflict keys.** They were applied to `units.json` and logged in `factory/key-overrides.log`. Read that log before trusting `dag.md` alone.
- **foa-57, a pane the owner started, built #57's slices.** The orchestrator could not message it directly. Relaying through t11 worked.

## For the owner

`YOUR-TODO.md` in this folder lists the human-only work:
- the billing lock;
- merging #138 and #139;
- the database stack and Vercel env vars;
- the HR-01 secrets;
- the HR-19 and HR-20 legal decisions;
- the rest of the HR residue.

The panes the owner started in the Herdr tab, t11 and t16 (foa-57), were not stopped by the orchestrator: close them in the app.

## Suggested skills for the next agent

- `herdr-hc`: running and watching panes on the server.
- `tdd`: building every unit test-first at Seam 1.
- `pr`: writing PR bodies.
- `code-review`: the Standards and Spec reviews.
- `diagnosing-bugs`: gate failures.
- `codebase-design`: designing risk-flagged units.
