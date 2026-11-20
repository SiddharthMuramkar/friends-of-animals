# Companion files for the execution spec

These files are the research the execution spec (`docs/specs/issue-factory-spec.md`) was built from. The spec cites them by
name (for example `dag.md` or `tournaments.md §1.1`); every such name means the file in this folder.

Precedence:

1. The spec wins over these files everywhere, except for the registers and numbers it explicitly delegates to them:
   - `dag.md`: work units, dependency edges, conflict groups, waves, critical path, branch/PR/session totals.
   - `tournaments.md`: split children, tournament kinds, contenders, design angles, judge counts, tournament cut order.
   - `residue.md`: human-residue register HR-01..HR-67, residue child issues, Day-0 owner checklist.
2. These files were written before the branch model was settled. Where they say `factory/trunk`, read "the unit's
   milestone branch `M<k>`". Where they say a ticket PR is squash-merged, the spec's merge-commit rule wins.
3. Native GitHub dependency edges are read at bootstrap (spec section 7, P0-8). `dag.md`'s edges are a fit to the
   per-issue counts in `dep-counts.json` and are replaced where the real edges differ.

| File | What it holds |
| --- | --- |
| `dag.md` | Work-unit list, edges, conflict groups, 35-wave baseline, totals, usage estimate |
| `dagmodel.py`, `dep-counts.json` | Re-runnable model behind `dag.md`'s numbers (`python3 -I dagmodel.py dep-counts.json dagout.json`) |
| `tournaments.md` | Split register and tournament register with per-unit design angles |
| `residue.md` | Human-residue register, child-issue plan, Day-0 checklist |
| `spec55.md` | Digest of spec #55: modules, ports, seams, rulings, providers |
| `issues-M0.md` … `issues-M6-M8.md` | Per-ticket analysis: dependencies, AFK class, residue, size, risk, test plan, hotspots |
| `code-server.md` | DB layer, migrations, test harness, migration-regeneration procedure |
| `platform.md` | Claude Code headless, hooks, cloud sessions, usage limits (with UNCONFIRMED markers) |
| `rubrics-input.md` | Rubric design input behind spec section 11 |
