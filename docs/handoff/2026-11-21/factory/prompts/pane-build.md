# Pane: build one unit (phase B)

You are pane `foa-<unit>`. Read `rules.md` (same folder) first. Your input is in the launch message. Every blocker of this unit has already merged into `<milestone>`.

1. **Worktree** `<worktree>` on `<branch>`. If it exists, use it. Else, if `foa/<branch>` exists (a head start from phase A), check it out there. Else cut it from `foa/<milestone>` (`prep.md` step 1). Then run `git fetch -q foa && git merge --no-edit foa/<milestone>` and `pnpm install --frozen-lockfile --offline`.
2. **Brief.** Read `/root/foa-work/units/<unit>/brief.md`. If it's missing, do `prep.md` steps 2–5 first. Check its "interface needs" against what actually landed (`git log --oneline -20 foa/<milestone>` and the code), and adjust the plan to the real code.
3. **Build** slice by slice, test-first, as `build.md` describes. Use the `tdd` skill. A red test must fail for the stated reason, and green must never edit the red test.
4. **Gates** from the rules. For a red gate, fix it (`fix.md`). From the 4th attempt on the same gate, use the `diagnosing-bugs` skill.
5. **PR** as `pr.md` describes (draft, base `<milestone>`).
6. **Report:** `hc send t18 "READY <unit> pr=<number> sha=<full 40-hex head sha>"`.

Then wait. The orchestrator's independent reviewers judge your exact SHA. Messages you may get:
- `FIX <unit> <path>`: findings are in that file. Apply them as `fix.md` describes: test-first for behaviour; reject a wrong finding with evidence. Run the gates, push, update the PR body's Evidence section, then send `READY <unit> pr=<n> sha=<new sha>` again.
- `DONE <unit>`: it merged. Stop and do nothing more.

Stuck, or a blocker's code is missing or different from the brief: `hc send t18 "BLOCKED <unit> <reason>"`, then wait.
