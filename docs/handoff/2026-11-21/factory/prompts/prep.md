# Stage: prep (one unit)

Input: `unit`, `issue`, `title`, `milestone`, `branch`, `worktree`, `risk`, `size`, `keys`, `blockers`, `siblings` (other units of the same issue with their titles), `adopt` (true when another session already built this branch).

1. **Worktree.** Run `git -C /root/friends-of-animals fetch -q foa`.
   - If `worktree` exists and is on `branch`, reuse it.
   - Else, if `foa/<branch>` exists, run `git -C /root/friends-of-animals worktree add <worktree> <branch>`. If the local branch is missing, use `-b <branch> foa/<branch>`.
   - Else run `git -C /root/friends-of-animals worktree add -b <branch> <worktree> foa/<milestone>`.

   Then `cd <worktree> && pnpm install --frozen-lockfile --offline` (without `--offline` if the store misses a package). Record `base_sha = git merge-base HEAD foa/<milestone>`.
2. **Read.**
   - The ticket and #55's decisions (see rules).
   - Your ticket's section in `docs/specs/issue-factory/issues-M*.md`, and its split proposal when `siblings` is non-empty. This unit covers only its own part; the siblings cover the rest.
   - `/root/foa-work/briefs/<issue>.md` if it exists.
   - The code your unit touches, and `git log --oneline foa/<milestone> -15` to see what already landed.
3. **Design** (only when `risk` is true, or the unit adds a new module or port). Use the `codebase-design` skill's vocabulary to compare 2–3 interface designs in this context. Don't spawn agents. Pick one, and write why in the brief.
4. **Brief.** Write `/root/foa-work/units/<unit>/brief.md`, at most about 120 lines:
   - scope (in and out, naming which sibling owns what);
   - each acceptance criterion rewritten as a numbered, testable check, with the seam that proves it;
   - files to create or touch, and hotspot or conflict notes;
   - the chosen design;
   - residue, as human-only items with HR ids where one fits;
   - test plan.
5. **Slices.** Split the work into ordered vertical slices: 1 for size M, 2–5 for size L, at most 6. Each slice is one behaviour proved by one test file, built on the previous slice.

Don't edit product code in this stage. Return `ok`, `worktree`, `base_sha`, `acs` [{index, text, human}], `slices` [{id, acs, behaviour, seam, test_file}], `residue` [strings] and a `summary`.
