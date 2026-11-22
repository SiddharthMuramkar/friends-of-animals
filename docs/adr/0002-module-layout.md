---
Status: accepted
---

# Domain modules live in `src/server/modules/<module>/`

The M0 foundations stay where they are: `src/server/identity`, `access`,
`audit`, `outbox`, `mailbox`, `observability`, `ports`, `seed` and `db`, and
no others. Every domain module introduced from #58 onward lives in
`src/server/modules/<module>/`: second factor, consent, notifications,
institutions, competitions, cms, codes, and every later one. We chose one home
for them so that parallel units, which each carried their own copies of shared
modules, converge on one path instead of several.

## Consequences

- A unit that lands a module anywhere else moves it before its review
  passes. #60 moves `src/server/second-factor` to
  `src/server/modules/second-factor`, which matches the copies already
  carried by 69, 70, 72, 73, 88 and 116.
- #61 landed `src/server/notifications` before this ruling. The next unit
  that touches it (61b) moves it to `src/server/modules/notifications`, the
  path that 69, 73, 88 and 89a already carry.
- When a branch syncs with main, main's version of a module is canonical:
  delete the carried copy and import main's.
