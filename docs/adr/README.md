# Architecture decision records

An ADR is a decision that has already been made, with evidence in this repo. Agents read these before changing the area they cover.

| Status | Meaning |
| --- | --- |
| Accepted | This is what the repo does. Do not quietly do the opposite. |
| Pending | The question is open. The file records the disagreement and where it is tracked. It is not a decision. Do not build as if one option had won. |
| Superseded | An older decision replaced by a newer ADR. |

| ADR | Status | Subject |
| --- | --- | --- |
| [0001](0001-starter-stack.md) | Accepted | The code in this repo is a React Router, Drizzle, and Postgres starter. |
| [0002](0002-platform-stack.md) | Pending | Which stack the full platform will use. Tracked in issue #11. |
| [0003](0003-local-postgres.md) | Accepted | Local Postgres is the `rescue` database on `127.0.0.1` port 5432. Reach it from elsewhere through an SSH tunnel. |
| [0004](0004-registered-logo.md) | Accepted | The logo is traced and used as-is. |

Copy `template.md` when a decision is actually made. Do not open an ADR to hold a guess.

These are open and are not ADRs yet: the 33 spec contradictions (issue #15), the two logo questions (issue #17), production hosting (issues #12 and #13), and the provider paperwork (issue #18).
