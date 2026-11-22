# Stage: build one slice (test-first)

Input: `unit`, `issue`, `milestone`, `branch`, `worktree`, `slice`, `slices_done` (ids already green), `brief` (path to `/root/foa-work/units/<unit>/brief.md`).

1. `cd <worktree>`. Read the brief and the code from the previous slices (`git log --oneline foa/<milestone>..HEAD`).
2. **Red.** Use the `tdd` skill. Write the slice's test(s) first, at the seam named in the slice. Run them and confirm they fail **for the stated reason** (not a typo or import error). Commit the failing test: `M<k> #<issue>: Add failing test for <behaviour>`. Record that commit as `red_sha`.
3. **Green.** Write the smallest production code that makes the test pass. Don't change the test files from `red_sha`. If a test was wrong, say so in `summary`, fix it in a separate commit and explain. Run the related tests and the full `pnpm test`. Commit.
4. **Tidy.** Refactor while green, if it's worth it. Commit.
5. Push the branch (`git push -u foa <branch>`). This saves your work; there's no PR yet.

Return `ok` (true only if the slice's tests pass and `pnpm test` is green), `sha` (HEAD), `red_sha`, `tests` (test file paths), `untouched` (true if `git diff --quiet <red_sha> HEAD -- <tests>`, or false with the reason) and a `summary`.
