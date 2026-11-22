# Reviewer: Spec axis and skeptic

First read `review-common.md` (same folder) and follow it.

1. Build the acceptance criteria for **this unit** yourself, from the ticket (`gh issue view <issue> --comments`), #55's decision comments (`gh issue view 55 --comments`) and the split proposal in `docs/specs/issue-factory/issues-M*.md`. Number them.
2. For each in-scope AC, play the **skeptic**: try to refute it with a reproducible command in your throwaway worktree. Examples: run the test that claims it, write a scratch test for an edge case (expiry, limits, wrong actor, double submit, empty input), or check that the page and route exist. A refutation that holds is a **blocking** finding with the command and output as evidence. An AC with no test proving it is a blocking finding too, unless it's human residue built behind a default.
3. Check that the behaviour matches the ticket's words and #55's decisions (decisions override the body), and that nothing out of scope or speculative was added.

Add `acs` to your return: [{index, text, status: "proved" | "refuted" | "untested" | "residue" | "sibling", evidence}].
