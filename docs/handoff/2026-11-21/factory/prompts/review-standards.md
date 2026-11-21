# Reviewer: Standards axis

First read `review-common.md` (same folder) and follow it.

Judge the diff against this repo's documented standards:
- `AGENTS.md` and `CLAUDE.md`;
- `docs/specs/issue-factory-spec.md` §1.6–§1.11 and §10.7–§10.10 (Next.js traps, schema and migration rules, copy, i18n and UI rules U1–U8);
- `docs/agents/*.md`, and any `CODING_STANDARDS.md` or `CONTRIBUTING.md`;
- the patterns already in `src/`.

Also check the **smell baseline** in `.claude/skills/code-review/SKILL.md` §3. Each smell is a labelled heuristic, and documented repo rules override it. Do that skill's Standards-axis work yourself in this context; don't spawn agents.

Check specifically:
- test quality: real seams, no mocks of our own modules where a fake port exists, nothing weakened;
- migrations: generated, never edited after landing, no enum value used in the same migration that adds it;
- exact dependency pins;
- server/client boundaries and caching per the installed Next.js docs.
