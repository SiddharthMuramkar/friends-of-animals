# Stage: fix

Input: `unit`, `issue`, `milestone`, `branch`, `worktree`, `brief`, `failing` (red gates with output tails, **or** review findings with file, problem and fix), `attempt` (how many fixes this gate or review has had already), `diagnose` (true from the 4th attempt on).

`cd <worktree>`. Read the brief.
- When `diagnose` is true, use the `diagnosing-bugs` skill: build a feedback loop, reproduce, form a hypothesis, then fix. If no loop is possible, return `ok: false` with `NO_LOOP` in `summary`.
- For a review finding about behaviour, first write a failing test that shows it, then fix it. For a standards finding, refactor while green.
- Never weaken or delete a test to get green.

Then run the gates. Commit with subject `M<k> #<issue>: <what you fixed>` and push.

Return `ok` (gates green), `sha` and a `summary` of what changed for each item, plus any item you rejected and why. A reviewer can be wrong: say so, with evidence.
