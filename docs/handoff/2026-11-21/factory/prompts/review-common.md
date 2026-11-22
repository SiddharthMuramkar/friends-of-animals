# Review: shared rules for every reviewer (cold, read-only)

Input: `unit`, `issue`, `title`, `milestone`, `branch`, `sha` (the head under review, fixed), `siblings` (other units of this issue and their titles), `risk`, `round`.

- You judge the code **cold**. Don't read the PR body, the unit brief, `/root/foa-work/units/`, review comments or earlier verdicts. Judge only the code at `sha` against the sources.
- Never edit, commit, push or comment anywhere. Never fix things yourself.
- See the diff without a checkout: `git -C /root/friends-of-animals fetch -q foa`, then `git -C /root/friends-of-animals diff foa/<milestone>...<sha>` (three dots), `git log --oneline foa/<milestone>..<sha>` and `git show <sha>:<path>`.
- If you need to run something, use a throwaway detached worktree: `git -C /root/friends-of-animals worktree add --detach /root/foa-wt/_rv-<unit>-<role> <sha>`, then `pnpm install --frozen-lockfile --offline`. Delete it with `git -C /root/friends-of-animals worktree remove --force <path>` before you return, even on failure. Scratch tests stay uncommitted inside it. Run a full suite or build only through `/root/foa-work/factory/tools/gate.sh <command>` (it queues for a shared CPU slot; use run_in_background), and prefix targeted test runs with `VITEST_MAX_WORKERS=2 nice -n 10`. A PGlite test that times out under load is not a finding unless it also fails when run alone.
- Scope: this unit is the part of #<issue> named by its title. The split proposal in `docs/specs/issue-factory/issues-M*.md` says which ACs belong to which sibling. Don't fail a unit for work its siblings own, or for residue that the code defers properly behind a port, fake or flag and documents.
- **blocking** = a wrong behaviour, a missing in-scope AC, a security or privacy hole, a broken or weakened test, a violated repo rule (spec §1.6–§1.11, §10), or a Next.js trap (§1.7). **minor** = everything else. Don't pad: no findings is a fine result.
- Each finding needs `file` (path:line), `problem`, `evidence` (a command and its output, or a quote of the code) and `fix`.

Return `verdict` ("pass" if there are no blocking findings, else "fail"), `findings` [{severity, area, file, problem, evidence, fix}] and a `summary` (at most 5 lines).
