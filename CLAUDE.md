@AGENTS.md

## Agent skills

### Issue tracker

GitHub Issues on `SiddharthMuramkar/friends-of-animals`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Sub-agents

Claude Code sub-agents for this repo are the markdown files in `.claude/agents/`. Each one has a single job. Read `GLOSSARY.md` before naming a domain concept.

### Cloud agents

`.cursor/environment.json` is the Cursor cloud-agent setup: `.cursor/cloud-install.sh` installs Node 26, pnpm and the dependencies, and `.cursor/cloud-start.sh` starts a local Postgres (no Docker) with the database and login from `.env.example`.
