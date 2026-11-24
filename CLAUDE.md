@AGENTS.md

Read `README.md` before starting a ticket. It explains the architecture, the ticket board (what is done and what is left), the migration rules, and how to work and land a ticket.

## Issue tracker

Issues live in GitHub Issues on `SiddharthMuramkar/friends-of-animals`. Use the `gh` CLI for them. The only git remote is `foa`.

- Read an issue: `gh issue view <n> --json number,title,body,labels,comments`.
- Blocking uses GitHub's native issue dependencies: `gh issue edit <child> --add-blocked-by <blocker>`. A ticket is startable when `gh api repos/SiddharthMuramkar/friends-of-animals/issues/<n> --jq .issue_dependencies_summary.blocked_by` prints 0.
- Sub-issues: `gh issue create --parent <n> ...` or `gh issue edit <parent> --add-sub-issue <child>`.
- A PR that finishes a ticket says `Closes #N`. A PR that lands one part of a ticket says `Refs #N`.
- Comment with the reason before closing an issue by hand.

## Triage labels

The five default labels are used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.

## Domain docs

Single context: one `GLOSSARY.md` and `docs/adr/` at the repo root. Name domain concepts with the glossary's terms, and call out any change that contradicts an ADR.
