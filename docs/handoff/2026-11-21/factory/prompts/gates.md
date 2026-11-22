# Stage: gates (read-only except for formatting)

Input: `unit`, `worktree`, `branch`.

`cd <worktree>`. If `pnpm format:check` fails only on formatting, run `pnpm format`, commit `M<k> #<issue>: Format`, and continue. Then run the three gates from the rules exactly, in order. Stop at the first failure, but still report it. Don't fix anything else.

Return `gates`: [{name: "check" | "build" | "clean-tree", status: "pass" | "fail", tail: the last 40 relevant lines of output on failure, else ""}], `sha` (HEAD after any format commit), `ok` (all pass) and `summary`.
