@AGENTS.md

## Agent skills

### Issue tracker

GitHub Issues on `SiddharthMuramkar/friends-of-animals`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`. ADR-0002 (the platform stack) is pending. Do not treat it as decided.

### Sub-agents

Claude Code sub-agents for this repo are the markdown files in `.claude/agents/`. Each one has a single job. Read `GLOSSARY.md` before naming a domain concept.

### Cloud agents

`.cursor/environment.json` is the Cursor cloud-agent setup: install dependencies, and start a local Postgres using the values in `.env.example`.
