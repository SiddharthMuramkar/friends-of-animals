# Stage: pull request

Input: `unit`, `issue`, `title`, `milestone`, `branch`, `worktree`, `brief`, `residue`, `gates`.

`cd <worktree>`. Push the branch. If an open PR already exists for `branch` (`gh pr list --repo siddhartxts/friends-of-animals --head <branch> --state open --json number`), update its body. Otherwise create one with `gh pr create --repo siddhartxts/friends-of-animals --draft --base <milestone> --head <branch> --title "M<k> #<issue>: <title>" --body-file <file>`.

Write the body with the `pr` skill. The first line is `Refs #<issue>. Lands in <milestone>.` Then:
- **Summary:** a smallest-view file tree with `# why` comments; new dependencies with exact versions.
- **Evidence:** the red run per acceptance criterion, the green gate counts and the build.
- **Not run:** the Seam-2 journey (no Postgres here; Vercel previews down), plus CI (Actions billing lock) and the preview: all deferred.
- **Merge Danger:** the door, the blast radius, and what to do on the VPS after merge.
- **Residue:** one line per item, or "None."

End the body with the 🤖 Claude Code line.

Return `ok`, `pr` (number), `sha` (the PR head, from `gh pr view <n> --json headRefOid`) and `summary`.
