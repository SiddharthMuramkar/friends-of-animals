# M0 status (spec #55): snapshot 2026-11-21 04:30 UTC

Read from `gh` and `git ls-remote foa` at that time. `M0` = 442dd99, `main` = eb1bb89. The only open PRs are #136 (M0 → main, draft), #138 and #139 (both → main). No ticket branch exists on the remote, and GitHub has no child issues for the units (57a, …) and no HR issues. Every issue #57–#68 is OPEN with the label `ready-for-agent`. "Native" is GitHub's `blocked_by` for the parent issue. "Waits for" is spec §2.2 and dag.md, which match the native edges. Keys are the spec §3.3 conflict keys: two units holding the same key shouldn't be in flight together, or must be resolved at merge.

| Unit | What | Live state (gh / git) | Native | Waits for | Keys | Can start | Residue |
|---|---|---|---|---|---|---|---|
| 57a | Seam 1 harness, composition root, form kit | **In progress (foa-57).** Local branch `ticket/57-harness` in /root/foa-wt/57 at 442dd99. No commits yet, not pushed, no PR | — | — | X1 | now | HR-60 |
| 57b | Email OTP sign-up and sign-in (Better Auth) | Not started. Will be `ticket/57-email-otp`, stacked on 57a | — | 57a | X2 X5 | once 57a's PR is open (foa-57 stacks it) | HR-01 02 11 12 19 20 30 |
| 57c | Sessions: list and revoke | Not started. Will be `ticket/57-sessions`, stacked on 57b | — | 57b | — | once 57b's PR is open (foa-57) | — |
| 58 | Phone OTP, encrypted phone column | No branch, no PR | #57 | 57b | X1 X2 | **57b merged** (merge after 61a and 65) | HR-05 14 |
| 59a | Roles, `can()`, append-only audit log | No branch, no PR | #57 | 57b | — (SQL) | **57b merged** | HR-17 18 30 |
| 59b | Role admin, audit search, dashboard switcher | No branch, no PR | #57 | 59a | X5 | 59a merged | HR-01 |
| 60 | Staff 2FA gate and step-up | No branch, no PR | #59 | 59a | X2 | 59a merged (merge after 65) | HR-11 17 19 |
| 61a | Outbox, JobQueue port, relay, welcome email | No branch, no PR | #57 | 57b | X1 (SQL) | **57b merged** | HR-12 |
| 61b | Worker runtime, `docker/workers.yml`, preview discovery | No branch, no PR | #57 | 61a | X6 | 61a merged | HR-07 |
| 62 | Runtime settings screen | No branch, no PR | #60 | 60 | — | 60 merged | HR-16 19 |
| 63a | Storage port, presign, signed delivery | No branch, no PR | #59 #61 | 59a, 61a | X1 X4 | 59a and 61a merged | HR-11 13 30 |
| 63b | ClamAV scan, quarantine | No branch, no PR | #59 #61 | 63a | X6 | 63a merged | HR-08 |
| 63c | Env prefixes, purge on drop, files journey | No branch, no PR | #59 #61 | 63b | — | 63b merged | HR-01 06 |
| 64 | Consent documents, consent to messages | No branch, no PR | #59 #61 | 59a, 61a | — (SQL) | 59a and 61a merged | HR-20 |
| 65 | CSP: static public, nonce on signed-in pages | No branch, no PR | #57 | 57b | X2 X3 X4 | **57b merged** (merge after 66a) | HR-19 |
| 66a | App Sentry with a personal-data scrubber | No branch, no PR | — | 57a | X3 | **57a merged** | HR-22 30 |
| 66b | Worker errors, heartbeat, uptime, log retention | No branch, no PR | — | 61b, 66a | X6 | 61b and 66a merged | HR-07 22 23 24 |
| 67 | Restore drill | **Done on M0** (519f9ed, merge 9c69f10). Issue still OPEN; it closes when #136 merges (`Closes #67`) | — | — | — | nothing to do | HR-26 |
| 68 | Nightly R2 → B2 copy | No branch, no PR | #63 | 63a, 66a | X6 | 63a and 66a merged | HR-13 22 25 30 |

## Next up

1. **Now:** only 57a (foa-57). Nothing else can start: every other unit needs the 57a harness. #66 has no native blocker, but its fake registers through 57a's port registry.
2. **The moment 57a merges into M0:** start **66a** (`briefs/66.md`). foa-57 carries on with 57b and then 57c.
3. **The moment 57b merges:** start **59a**, **61a** and **65** in parallel (`briefs/59.md`, `61.md`, `65.md`). **58** can start too (`briefs/58.md`), but it shares X1 with 61a and X2 with 65, so merge it after both of those and rebase. 59a replaces the `can()` stub internals that 57a–57c create; if 57c is still open, 59a rebases onto it.
4. **Then:** 59b and 60 after 59a (60 after 65 too, because of X2). 61b after 61a. 63a and 64 once 59a and 61a are both in. After that: 62, 63b → 63c, 66b, 68.
5. **Preview checks stay red or deferred** until the owner clears YOUR-TODO steps 1–7. Today every PR fails CI (GitHub Actions billing lock) and the Vercel build (no database URLs).
