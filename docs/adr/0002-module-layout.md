---
Status: accepted
---

# Domain modules live in `src/server/modules/<module>/`

The M0 foundations stay where they are: `src/server/identity`, `access`,
`audit`, `outbox`, `mailbox`, `observability`, `ports`, `seed` and `db` (and
#61's `notifications`, which predates this ruling). Every domain module
introduced from #58 onward lives in `src/server/modules/<module>/`: second
factor, consent, notifications from then on, institutions, competitions, cms,
codes, and every later one. We chose one home for them so that parallel units,
which each carried their own copies of shared modules, converge on one path
instead of several.

## Consequences

- A unit that lands a module anywhere else moves it before its review
  passes. #60 moves `src/server/second-factor` to
  `src/server/modules/second-factor`, which matches the copies already
  carried by 69, 70, 72, 73, 88 and 116.
- When a branch syncs with main, main's version of a module is canonical:
  delete the carried copy and import main's.
