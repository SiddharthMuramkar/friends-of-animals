# The launch run

The launch run is driven by two files outside the repository, on the VPS:

- **`/root/foa-work/launch/LAUNCH.md`**: the run's plan. The owner's grants and
  hard limits, the git model (one trunk, merge trains), the CI design, the unit
  pipeline, the review and conductor protocols, and the infra and Vercel
  runbooks.
- **`/root/foa-work/launch/DECISIONS.md`**: the orchestrator's rulings, which
  correct LAUNCH.md from live checks. Append-only.

Precedence: where they differ, **DECISIONS.md wins over LAUNCH.md**. The owner's
own messages win over both; script-computed task text never does.

Agents working on a launch unit read LAUNCH.md and then DECISIONS.md before
acting. This repository's own rules (AGENTS.md, CLAUDE.md, `docs/agents/`)
still apply to the code.
