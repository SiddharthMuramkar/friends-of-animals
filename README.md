# Friends of Animals

The project reference for the Friends of Animals (FOA) platform: what it is, how it is built, what is done, what is left, and how to land the next ticket. Dated **2026-11-24**. Words in this file follow [`GLOSSARY.md`](GLOSSARY.md).

## Contents

1. [What this is](#what-this-is): live URLs, [status at a glance](#status-at-a-glance), [landed this session](#landed-this-session)
2. [Ticket board](#ticket-board): per milestone, [next tickets you can pick up](#next-tickets-you-can-pick-up), [tickets blocked on owner items](#tickets-blocked-on-owner-items)
3. [Architecture](#architecture)
4. [Domain modules](#domain-modules) and [worker jobs](#worker-jobs-and-schedules)
5. [Codebase map](#codebase-map)
6. [Database and migrations](#database-and-migrations)
7. [Local setup](#local-setup)
8. [Testing and CI](#testing-and-ci)
9. [Deploy and infrastructure](#deploy-and-infrastructure)
10. [Environment variables](#environment-variables)
11. [Owner-only blockers and the HR register](#owner-only-blockers-and-the-hr-register)
12. [How to work a ticket](#how-to-work-a-ticket)
13. [Known gaps and cleanup candidates](#known-gaps-and-cleanup-candidates)

## What this is

FOA is a non-profit in India that nurtures compassion for animals among children and young adults, through creative competitions, community, awareness, adoption and fundraising. This repo is its web platform. Schools and individuals register for competitions, pay fees, give consent (guardians for minors) and submit entries. Staff run competitions, payments, refunds, the ledger, content, safeguarding and privacy. It is one Next.js app on Vercel plus a background worker and Postgres on a VPS. Most of it was written by agent swarms working tickets from GitHub issue [#55](https://github.com/SiddharthMuramkar/friends-of-animals/issues/55), the product spec.

| What                             | URL                                                              |
| -------------------------------- | ---------------------------------------------------------------- |
| Public site                      | https://friendsofanimals.dev (`www.` redirects to it)            |
| Health                           | https://friendsofanimals.dev/api/health and `/api/health/worker` |
| Error tracking (GlitchTip)       | https://errors.friendsofanimals.dev                              |
| Analytics (Umami)                | https://stats.friendsofanimals.dev                               |
| Database pooler (PgBouncer, TLS) | `db.friendsofanimals.dev:6432`                                   |
| Repo, issues, CI                 | https://github.com/SiddharthMuramkar/friends-of-animals          |

### Status at a glance

Production serves commit `375eb35d` (deployed 2026-11-24, before this session's merges). **Nothing merged this session is live yet.** The worker runs even older code, `646cb69` (2026-11-22). See [Live state](#live-state).

| Area                                                          | In production today                             | Why, and what turns it on                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Public pages (home, about, impact, competitions, blog, legal) | Works                                           | -                                                                                                    |
| `/api/health`, `/api/health/worker`                           | Works; health says `"facts":"incomplete"`       | FOA's real facts are not entered (HR-21)                                                             |
| Email sign-in                                                 | **Off**: `/sign-in` shows "Sign-in opens soon"  | AWS has not approved SES production access (HR-12)                                                   |
| Staff area (`/admin/*`)                                       | Nobody can use it                               | Needs sign-in, then the first super admin (HR-17, HR-18)                                             |
| Phone (SMS) sign-in                                           | Off                                             | DLT registration through MSG91 (HR-14), then the `sms.enabled` setting                               |
| Payments, refunds                                             | Every payment refused                           | No live Razorpay keys (HR-15)                                                                        |
| Uploads, entries                                              | Refused                                         | No Cloudflare R2 account (HR-13); scans need R2 on the worker; derivatives need worker-media (HR-35) |
| Guardian, minor, consent-link and paper-consent flows         | Off in code (PR #279)                           | Safeguarding sign-off and legal copy (HR-32, HR-33)                                                  |
| Email and SMS queued through the outbox                       | Refused by the worker                           | A code gap plus SES and MSG91 keys ([Code gaps](#code-gaps))                                         |
| Error tracking                                                | On (GlitchTip)                                  | -                                                                                                    |
| Analytics                                                     | Off: `/stats/script.js` answers 404             | `UMAMI_ORIGIN` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID` missing on Vercel (HR-52)                          |
| Content Security Policy                                       | Report-Only                                     | Enforcing it is HR-19 and a change in `src/lib/csp.ts`                                               |
| Canonical URL, sitemap, `robots.txt`                          | Wrong host (`friends-of-animals.vercel.app`)    | Vercel `APP_URL` must be `https://friendsofanimals.dev` ([Go-live](#go-live))                        |
| Database backups                                              | Nightly, on the same disk; restore drill passed | No off-site copy yet (HR-25; no open issue tracks it)                                                |
| Off-site copy of files                                        | Not configured; both runs failed                | B2 bucket and keys (HR-25)                                                                           |
| Worker                                                        | Running, healthy heartbeat, old code            | Rebuild from `main` ([Rebuild the production worker](#rebuild-the-production-worker))                |

### Landed this session

Every PR below is merged into `main`. Each said `Refs #N`, so GitHub closed none of the issues. The finished ones were closed by hand on 2026-11-24 after a check against their acceptance criteria ([Totals](#totals)).

| PR                                                                       | Ticket, unit     | What it added                                                                 |
| ------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| [#282](https://github.com/SiddharthMuramkar/friends-of-animals/pull/282) | #105, unit 105-2 | Staff ledger pages (`/admin/ledger`)                                          |
| [#268](https://github.com/SiddharthMuramkar/friends-of-animals/pull/268) | #85, unit 85b-2  | Participant entry pages (`/participant/entries`)                              |
| [#264](https://github.com/SiddharthMuramkar/friends-of-animals/pull/264) | #84, unit 84a-2  | Competition announcements; migrations `0068`-`0070`                           |
| [#277](https://github.com/SiddharthMuramkar/friends-of-animals/pull/277) | #114, unit 114-1 | Read-only data inventory page (`/admin/privacy`) and per-column coverage test |
| [#266](https://github.com/SiddharthMuramkar/friends-of-animals/pull/266) | #114, unit 114-2 | Retention sweep and legal holds; migrations `0071`-`0072`                     |
| [#262](https://github.com/SiddharthMuramkar/friends-of-animals/pull/262) | #80, unit 80b    | Cancelling a competition refunds everyone; migrations `0073`-`0075`           |
| [#267](https://github.com/SiddharthMuramkar/friends-of-animals/pull/267) | #116, unit 116b  | Breach log and notices (`/admin/breaches`); migrations `0076`-`0078`          |
| [#283](https://github.com/SiddharthMuramkar/friends-of-animals/pull/283) | -                | Cleanup and this README                                                       |

PR #270 (an early #105 draft) was closed as superseded by #276, #281 and #282.

The cleanup PR #283 removed the old agent tooling and stale docs: `docs/handoff`, `docs/specs` (the issue-factory unit plan and the HR register), `docs/agents`, `docs/brand`, `.cursor`, `.claude/skills`, `skills-lock.json`, `src/components/ui`, a few unused files (`.github/scripts/redact-bypass-cookie.py`, `src/components/site/prose.tsx`, `src/components/site/stub-page.tsx`, `src/content/competitions/welfare.ts`), the `radix-ui` and `sonner` packages, and `experimental.optimizePackageImports` in `next.config.ts`. The pending ADRs became `docs/adr/0005`-`0009`. Everything still useful from those files is in this README. Every other branch on GitHub was deleted; they are archived locally ([Restore an archived draft branch](#restore-an-archived-draft-branch)).

## Ticket board

The product is specified in issue [#55](https://github.com/SiddharthMuramkar/friends-of-animals/issues/55) (kept open as the parent) and split into tickets #56 to #135. Issues #1 to #52 are older research tasks and bug batches, all closed, and left out here.

### Words used on the board

| Word           | Meaning                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone      | M0 to M8. GitHub has **no milestone objects**: the milestone is the prefix of the issue title ("M2: ...").                                  |
| Unit           | One slice of a ticket that ships as one PR, for example 80a and 80b. Some were split again (84a-1, 84a-2).                                  |
| Blocked by     | GitHub's native issue dependencies, not text in the issue body. A blocker counts as cleared only when its issue is **closed**.              |
| Archived draft | An early agent branch that never reached `main`. Deleted from GitHub on 2026-11-24 and kept in a local git bundle. Reference material only. |
| Train          | A batch PR (`train/NNN`) that carried units into `main` during the launch run. No longer used.                                              |

Status was judged from code on `main`, not from GitHub's open or closed flag. **done** means every unit is on `main`. **partly done** means some units landed. **not started** means no code on `main`.

### M0: foundations

| Issue                                                                    | Title                                               | GitHub | Status                                              | Left, notes                       |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ------ | --------------------------------------------------- | --------------------------------- |
| [#56](https://github.com/SiddharthMuramkar/friends-of-animals/issues/56) | CI on every PR                                      | closed | done (`.github/workflows/ci.yml`)                   | -                                 |
| [#57](https://github.com/SiddharthMuramkar/friends-of-animals/issues/57) | Sign up and sign in by email one-time code          | closed | done, 57a-57c (`src/server/identity/email-code.ts`) | Production email waits on HR-12   |
| [#58](https://github.com/SiddharthMuramkar/friends-of-animals/issues/58) | Sign in by phone one-time code                      | closed | done                                                | Production SMS waits on HR-14     |
| [#59](https://github.com/SiddharthMuramkar/friends-of-animals/issues/59) | Scoped roles, `can()` policy, audit log             | closed | done, 59a-59b                                       | -                                 |
| [#60](https://github.com/SiddharthMuramkar/friends-of-animals/issues/60) | Staff two-factor gate and step-up                   | closed | done ([`second-factor`](#second-factor))            | -                                 |
| [#61](https://github.com/SiddharthMuramkar/friends-of-animals/issues/61) | Outbox and background worker                        | closed | done, 61a-61b (`src/server/outbox/`, `src/worker/`) | -                                 |
| [#62](https://github.com/SiddharthMuramkar/friends-of-animals/issues/62) | Runtime settings screen                             | closed | done ([`settings`](#settings))                      | -                                 |
| [#63](https://github.com/SiddharthMuramkar/friends-of-animals/issues/63) | Private file uploads, malware scan, signed delivery | closed | done, 63a-63c ([`files`](#files))                   | Production storage waits on HR-13 |
| [#64](https://github.com/SiddharthMuramkar/friends-of-animals/issues/64) | Consent documents and consent to messages           | closed | done ([`consent`](#consent))                        | -                                 |
| [#65](https://github.com/SiddharthMuramkar/friends-of-animals/issues/65) | Content Security Policy                             | closed | done (`src/lib/csp.ts`)                             | Report-Only in production (HR-19) |
| [#66](https://github.com/SiddharthMuramkar/friends-of-animals/issues/66) | Error tracking, uptime checks, 365-day logs         | closed | done, 66a-66b                                       | Log store waits on HR-24          |
| [#67](https://github.com/SiddharthMuramkar/friends-of-animals/issues/67) | Restore drill into a throwaway container            | closed | done (`docker/scripts/restore-drill.sh`)            | -                                 |
| [#68](https://github.com/SiddharthMuramkar/friends-of-animals/issues/68) | Nightly copy of R2 files to Backblaze B2            | closed | done ([`offsite-copy`](#offsite-copy))              | "Not configured" until HR-25      |

### M1: competitions, institutions, registration and fees

| Issue                                                                    | Title                                                | GitHub | Status                                                                                                                          | Left, notes                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [#69](https://github.com/SiddharthMuramkar/friends-of-animals/issues/69) | Message templates, inbox, channel preferences        | closed | done ([`notifications`](#notifications))                                                                                        | -                                             |
| [#70](https://github.com/SiddharthMuramkar/friends-of-animals/issues/70) | Create and publish a competition                     | closed | done, 70a-70b ([`competitions`](#competitions))                                                                                 | -                                             |
| [#71](https://github.com/SiddharthMuramkar/friends-of-animals/issues/71) | Schedule changes competition status                  | closed | done (`competitions/status-jobs.ts`)                                                                                            | -                                             |
| [#72](https://github.com/SiddharthMuramkar/friends-of-animals/issues/72) | Fees, award schemes, attached consent documents      | closed | done (`competitions/terms/`)                                                                                                    | -                                             |
| [#73](https://github.com/SiddharthMuramkar/friends-of-animals/issues/73) | Institution registration and verification            | closed | done ([`institutions`](#institutions))                                                                                          | -                                             |
| [#74](https://github.com/SiddharthMuramkar/friends-of-animals/issues/74) | Institution coordinators                             | closed | done (`institutions/coordinators/`)                                                                                             | -                                             |
| [#75](https://github.com/SiddharthMuramkar/friends-of-animals/issues/75) | Register an institution, enrol students              | closed | done, 75a-75b ([`registration`](#registration))                                                                                 | -                                             |
| [#76](https://github.com/SiddharthMuramkar/friends-of-animals/issues/76) | Import students from CSV                             | closed | done (`registration/domain/student-csv.ts`)                                                                                     | -                                             |
| [#77](https://github.com/SiddharthMuramkar/friends-of-animals/issues/77) | Bulk fee payment for an institution                  | closed | done, 77a-77c ([`payments`](#payments))                                                                                         | Live payments wait on HR-15                   |
| [#78](https://github.com/SiddharthMuramkar/friends-of-animals/issues/78) | Individual adult registration, participant dashboard | closed | done ([`participants`](#participants))                                                                                          | -                                             |
| [#79](https://github.com/SiddharthMuramkar/friends-of-animals/issues/79) | Offline payments, payments needing review            | closed | done                                                                                                                            | -                                             |
| [#80](https://github.com/SiddharthMuramkar/friends-of-animals/issues/80) | Refunds; cancelling a competition refunds everyone   | closed | done, 80a (PR #257), refund settlement (PR #280), 80b cancellation (PR #262)                                                    | Live refunds wait on HR-15; defaults on HR-34 |
| [#81](https://github.com/SiddharthMuramkar/friends-of-animals/issues/81) | Guardians and minors                                 | closed | done, 81a-81b ([`guardians`](#guardians))                                                                                       | Off in production until HR-32, HR-33          |
| [#82](https://github.com/SiddharthMuramkar/friends-of-animals/issues/82) | Separate guardian consent per purpose                | closed | done                                                                                                                            | -                                             |
| [#83](https://github.com/SiddharthMuramkar/friends-of-animals/issues/83) | Coordinators collect guardian consent                | closed | done, 83a code link (PR #274, [`consent-links`](#consent-links)), 83b signed forms (PR #275, [`consent-forms`](#consent-forms)) | Off in production until HR-32, HR-33          |

### M2: submission, rubrics, school round, notifications

| Issue                                                                    | Title                                               | GitHub | Status                                                                                  | Left, notes                                                            | Archived draft                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| [#84](https://github.com/SiddharthMuramkar/friends-of-animals/issues/84) | Announcements and deadline reminders                | open   | **partly done.** 84a-1 audience (PR #273), 84a-2 delivery and pages (PR #264)           | **84b**: reminders (see [next tickets](#next-tickets-you-can-pick-up)) | `ticket/84-reminders`                            |
| [#85](https://github.com/SiddharthMuramkar/friends-of-animals/issues/85) | Image submission by an individual                   | closed | done, 85a derivatives (PR #201), 85b-1 entry lifecycle (PR #278), 85b-2 pages (PR #268) | Production uploads wait on HR-13, HR-35                                | -                                                |
| [#86](https://github.com/SiddharthMuramkar/friends-of-animals/issues/86) | Video and essay submissions                         | open   | not started. Entry file kinds `video`, `document`, `text` already exist                 | 86a video, 86b essay                                                   | `ticket/86-video`, `ticket/86-essay-sanitiser`   |
| [#87](https://github.com/SiddharthMuramkar/friends-of-animals/issues/87) | Coordinator submits for students, certifies conduct | open   | not started                                                                             | whole ticket                                                           | `ticket/87-coordinator-submits-for-students-and` |
| [#88](https://github.com/SiddharthMuramkar/friends-of-animals/issues/88) | Published rubrics gate the school round             | closed | done ([`judging`](#judging))                                                            | -                                                                      | -                                                |
| [#89](https://github.com/SiddharthMuramkar/friends-of-animals/issues/89) | School round: positions, shortlist, finalise        | open   | not started                                                                             | 89a picks, 89b finalise                                                | `ticket/89-picks`, `ticket/89-finalise`          |
| [#90](https://github.com/SiddharthMuramkar/friends-of-animals/issues/90) | Overdue, closed-on-behalf, reopened school rounds   | open   | not started                                                                             | whole ticket; also registers the `school_round_shortlist_due` reminder | `ticket/90-overdue-closed-on-behalf-and`         |
| [#91](https://github.com/SiddharthMuramkar/friends-of-animals/issues/91) | Shortlist-only submission scope                     | open   | not started                                                                             | 91a scope, 91b journey                                                 | `ticket/91-scope`, `ticket/91-journey`           |
| [#92](https://github.com/SiddharthMuramkar/friends-of-animals/issues/92) | FOA verification of digital entries                 | open   | not started                                                                             | whole ticket                                                           | `ticket/92-foa-verification-of-digital-entries`  |

### M3: physical artwork and FOA judging

| Issue                                                                    | Title                                       | Status      | Units                                      | Archived draft                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------- | ----------- | ------------------------------------------ | ------------------------------------------------------------------ |
| [#93](https://github.com/SiddharthMuramkar/friends-of-animals/issues/93) | Request, dispatch, receive physical artwork | not started | whole ticket                               | `ticket/93-request-dispatch-and-receive-physical`                  |
| [#94](https://github.com/SiddharthMuramkar/friends-of-animals/issues/94) | Verify physical artwork, record custody     | not started | whole ticket                               | `ticket/94-verify-physical-artwork-and-record`                     |
| [#95](https://github.com/SiddharthMuramkar/friends-of-animals/issues/95) | FOA rounds, judge onboarding, assignment    | not started | 95a rounds, 95b onboarding, 95c assignment | `ticket/95-rounds`, `ticket/95-onboarding`, `ticket/95-assignment` |
| [#96](https://github.com/SiddharthMuramkar/friends-of-animals/issues/96) | Blind scoring                               | not started | whole ticket                               | `ticket/96-blind-scoring`                                          |
| [#97](https://github.com/SiddharthMuramkar/friends-of-animals/issues/97) | Rankings, round lock, outcomes              | not started | whole ticket                               | `ticket/97-rankings-round-lock-and-outcomes`                       |
| [#98](https://github.com/SiddharthMuramkar/friends-of-animals/issues/98) | Chained judging levels                      | not started | whole ticket                               | `ticket/98-chained-judging-levels`                                 |

All M3, M4, M6, M7 and M8 issues are open on GitHub.

### M4: results, certificates, gallery, social export

| Issue                                                                      | Title                                                | Status      | Units                                            | Archived draft                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- | ------------------------------------------------ | ---------------------------------------------------------- |
| [#99](https://github.com/SiddharthMuramkar/friends-of-animals/issues/99)   | Results approval, scheduled publishing, results page | not started | 99a release, 99b page                            | `ticket/99-release`, `ticket/99-page`                      |
| [#100](https://github.com/SiddharthMuramkar/friends-of-animals/issues/100) | Certificates with QR verification                    | not started | 100a module, 100b verify, 100c PDF               | `ticket/100-module`                                        |
| [#101](https://github.com/SiddharthMuramkar/friends-of-animals/issues/101) | Revoke, reissue, bulk-download certificates          | not started | whole ticket                                     | `ticket/101-revoke-reissue-and-bulk-download`              |
| [#102](https://github.com/SiddharthMuramkar/friends-of-animals/issues/102) | Logo stamping, shareable certificate image           | not started | whole ticket                                     | `ticket/102-logo-stamping-and-shareable-certificate`       |
| [#103](https://github.com/SiddharthMuramkar/friends-of-animals/issues/103) | Public gallery with consent gating                   | not started | 103a pages, 103b purge, 103c reports, 103d crawl | `ticket/103-pages`, `ticket/103-purge`, `ticket/103-crawl` |
| [#104](https://github.com/SiddharthMuramkar/friends-of-animals/issues/104) | Social-media export queue                            | not started | whole ticket                                     | `ticket/104-social-media-export-queue`                     |

### M5: money, CMS, privacy, admin, analytics

| Issue                                                                      | Title                                                  | GitHub | Status                                                                           | Left, notes                                                            | Archived draft                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| [#105](https://github.com/SiddharthMuramkar/friends-of-animals/issues/105) | Ledger with automatic postings                         | closed | done, 105-1 backend (PRs #276, #281), 105-2 staff pages (PR #282)                | Chart of accounts waits on the accountant (HR-47)                      | -                                                |
| [#106](https://github.com/SiddharthMuramkar/friends-of-animals/issues/106) | One-time donations with receipts                       | open   | not started. `src/app/donate/page.tsx` is a static page only                     | 106a core, 106b donate page                                            | `ticket/106-core`, `ticket/106-donate-page`      |
| [#107](https://github.com/SiddharthMuramkar/friends-of-animals/issues/107) | Recurring donations                                    | open   | not started                                                                      | whole ticket                                                           | `ticket/107-recurring-donations`                 |
| [#108](https://github.com/SiddharthMuramkar/friends-of-animals/issues/108) | Offline donations and 80G receipts                     | open   | not started                                                                      | whole ticket                                                           | `ticket/108-offline-donations-and-80g-receipts`  |
| [#109](https://github.com/SiddharthMuramkar/friends-of-animals/issues/109) | Budgets, period lock, two approvers, accountant export | open   | not started                                                                      | 109a lock, 109b budgets                                                | `ticket/109-lock`, `ticket/109-budgets`          |
| [#110](https://github.com/SiddharthMuramkar/friends-of-animals/issues/110) | Transparency page                                      | open   | not started                                                                      | 110a page, 110b journey                                                | `ticket/110-page`, `ticket/110-journey`          |
| [#111](https://github.com/SiddharthMuramkar/friends-of-animals/issues/111) | CMS pages, home sections, impact counters              | closed | done, 111a-111b ([`cms`](#cms))                                                  | -                                                                      | -                                                |
| [#112](https://github.com/SiddharthMuramkar/friends-of-animals/issues/112) | Blog and stories                                       | closed | done, 112a-112b                                                                  | -                                                                      | -                                                |
| [#113](https://github.com/SiddharthMuramkar/friends-of-animals/issues/113) | Contact inbox                                          | closed | done ([`contact`](#contact))                                                     | -                                                                      | -                                                |
| [#114](https://github.com/SiddharthMuramkar/friends-of-animals/issues/114) | Data inventory and retention jobs                      | closed | done, Inventory catalogue, 114-1 page (PR #277), 114-2 sweep and holds (PR #266) | Periods wait on counsel (HR-31); `retention.enforce` is off until then | -                                                |
| [#115](https://github.com/SiddharthMuramkar/friends-of-animals/issues/115) | Privacy rights requests, grievance queue               | open   | not started                                                                      | 115a requests, 115b export and erase                                   | `ticket/115-requests`, `ticket/115-export-erase` |
| [#116](https://github.com/SiddharthMuramkar/friends-of-animals/issues/116) | Safeguarding reports and breach log                    | closed | done, 116a reports (PR #176), 116b breach log (PR #267)                          | Notices start off until HR-49, HR-50                                   | -                                                |
| [#117](https://github.com/SiddharthMuramkar/friends-of-animals/issues/117) | Admin home queues and basic reports                    | open   | not started                                                                      | 117a queues, 117b reports                                              | `ticket/117-reports`                             |
| [#118](https://github.com/SiddharthMuramkar/friends-of-animals/issues/118) | Cookieless web analytics (Umami)                       | closed | done (`src/lib/analytics/umami.ts`)                                              | Off in production until HR-52                                          | -                                                |

### M6: community, volunteers, events, campaigns

| Issue                                                                      | Title                                         | Status      | Units                                      | Archived draft                                            |
| -------------------------------------------------------------------------- | --------------------------------------------- | ----------- | ------------------------------------------ | --------------------------------------------------------- |
| [#119](https://github.com/SiddharthMuramkar/friends-of-animals/issues/119) | Community membership, engagement timeline     | not started | whole ticket                               | `ticket/119-community-membership-and-engagement-timeline` |
| [#120](https://github.com/SiddharthMuramkar/friends-of-animals/issues/120) | Post-competition invitations                  | not started | whole ticket                               | `ticket/120-post-competition-invitations`                 |
| [#121](https://github.com/SiddharthMuramkar/friends-of-animals/issues/121) | Clubs                                         | not started | whole ticket                               | `ticket/121-clubs`                                        |
| [#122](https://github.com/SiddharthMuramkar/friends-of-animals/issues/122) | Ambassadors                                   | not started | whole ticket                               | `ticket/122-ambassadors`                                  |
| [#123](https://github.com/SiddharthMuramkar/friends-of-animals/issues/123) | Volunteer applications                        | not started | whole ticket                               | `ticket/123-volunteer-applications`                       |
| [#124](https://github.com/SiddharthMuramkar/friends-of-animals/issues/124) | Volunteer tasks, hours, certificates          | not started | whole ticket                               | `ticket/124-volunteer-tasks-hours-and-certificates`       |
| [#125](https://github.com/SiddharthMuramkar/friends-of-animals/issues/125) | Events: publish, register, waitlist, check-in | not started | 125a publish, 125b waitlist, 125c check-in | `ticket/125-publish`, `ticket/125-waitlist`               |
| [#126](https://github.com/SiddharthMuramkar/friends-of-animals/issues/126) | Campaign messages to consented segments       | not started | whole ticket                               | `ticket/126-campaign-messages-to-consented-segments`      |

### M7: NGO directory and adoption

| Issue                                                                      | Title                                       | Status      | Units        | Archived draft                                              |
| -------------------------------------------------------------------------- | ------------------------------------------- | ----------- | ------------ | ----------------------------------------------------------- |
| [#127](https://github.com/SiddharthMuramkar/friends-of-animals/issues/127) | NGO directory listings and verification     | not started | whole ticket | `ticket/127-ngo-directory-listings-and-verification`        |
| [#128](https://github.com/SiddharthMuramkar/friends-of-animals/issues/128) | Directory search by service and distance    | not started | whole ticket | `ticket/128-directory-search-by-service-and`                |
| [#129](https://github.com/SiddharthMuramkar/friends-of-animals/issues/129) | Adoption listings                           | not started | whole ticket | `ticket/129-adoption-listings`                              |
| [#130](https://github.com/SiddharthMuramkar/friends-of-animals/issues/130) | Adoption applications, coordinator workflow | not started | whole ticket | `ticket/130-adoption-applications-and-coordinator-workflow` |

### M8: auctions, surveys, reports

| Issue                                                                      | Title                                        | Status      | Units                                            | Archived draft                                   |
| -------------------------------------------------------------------------- | -------------------------------------------- | ----------- | ------------------------------------------------ | ------------------------------------------------ |
| [#131](https://github.com/SiddharthMuramkar/friends-of-animals/issues/131) | Auction lots from consented artwork          | not started | whole ticket                                     | `ticket/131-auction-lots-from-consented-artwork` |
| [#132](https://github.com/SiddharthMuramkar/friends-of-animals/issues/132) | Bidding, outbid alerts, anti-sniping         | not started | whole ticket                                     | `ticket/132-bidding-with-outbid-alerts-and`      |
| [#133](https://github.com/SiddharthMuramkar/friends-of-animals/issues/133) | Auction payment, delivery, thank-you letters | not started | 133a payment, 133b letters                       | `ticket/133-payment`, `ticket/133-letters`       |
| [#134](https://github.com/SiddharthMuramkar/friends-of-animals/issues/134) | Feedback surveys                             | not started | whole ticket                                     | `ticket/134-feedback-surveys`                    |
| [#135](https://github.com/SiddharthMuramkar/friends-of-animals/issues/135) | Objective reports and social metrics         | not started | 135a social, 135b participation, 135c objectives | `ticket/135-social`                              |

### Totals

|                 | Count | Tickets                                        |
| --------------- | ----- | ---------------------------------------------- |
| Done and closed | 37    | #56-#83, #85, #88, #105, #111-#114, #116, #118 |
| Partly done     | 1     | #84 (84b left)                                 |
| Not started     | 42    | every other ticket from #86 to #135            |

#80, #83, #85, #105, #114 and #116 were finished by PRs that said `Refs #N`. They were closed by hand on 2026-11-24, each with a comment listing its PRs and the owner steps still open.

**The archived drafts** are reference material, not near-finished work. Never merge one.

| Kind                      | Commit subject                                                                                                                              | What is in it                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain core               | "Add ... domain core" (1-2 commits, 2026-11-21; a second commit may be "WIP paused by the orchestrator, not gated"; most of M3, M4, M6, M8) | Pure domain functions and tests, for example `src/server/modules/certificates/domain/*.ts` on `ticket/100-module`. No schema, no pages. Copying a pure file is usually safe. |
| Salvaged work in progress | "WIP salvaged by launch, not gated" (2-6 commits plus merges, 2026-11-21; most of M2, M5, M7)                                               | Never passed review or CI. Two (87, 89-picks) carry migrations numbered from `0004`, which clash with `main`. Regenerate any schema; never copy their `drizzle/` files.      |

Each draft is about 1,500 to 1,800 commits behind `main`. How to bring one back is in [Restore an archived draft branch](#restore-an-archived-draft-branch).

### Next tickets you can pick up

A ticket is startable when every GitHub "blocked by" issue is closed (check: `gh api repos/SiddharthMuramkar/friends-of-animals/issues/<n> --jq .issue_dependencies_summary.blocked_by` prints 0). The old unit plan sometimes named more blockers than GitHub does; the table says so where it matters. The scope column is the unit's agreed scope from the old unit briefs.

| Ticket                                                                            | GitHub blockers (all done) | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Where to start                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#84](https://github.com/SiddharthMuramkar/friends-of-animals/issues/84) unit 84b | #69, #71, #75, #78         | A reminder registry and a `reminder_job` table (status `scheduled`, `fired`, `cancelled`, `superseded`; all values in the first migration). One delayed job per row; `runReminder` locks the row and checks the deadline and who still owes it **at run time**. First reminder `entry_submission_due`, offsets from a setting (default 72 h and 24 h before `submissions_close`). Minors' reminders go to guardians; coordinators get one per run. Reschedule on key-date changes; cancel on competition cancellation. Later reminders (#90, #93, #125) add one definition file each. | Register in `SCHEDULES` or as delayed outbox events (`src/server/outbox/`). Reuse `src/server/modules/announcements/load-audience.ts` (its header says it is shared with reminders). The draft `ticket/84-reminders` has a pure core in `src/server/modules/reminders/domain/`. |
| [#86](https://github.com/SiddharthMuramkar/friends-of-animals/issues/86)          | #85                        | **86a video**: MP4, MOV, 3GP, WebM; size and length checked in the browser, at start and complete, and in worker-media (ffprobe); transcode to H.264/AAC MP4 at most 1080p with metadata dropped, plus a JPEG poster; ffmpeg in the worker-media image; ClamAV stream limit raised for 200 MB. **86b essay**: typed text (up to 1,500 words) through the one rich-text sanitiser (`src/server/rich-text/`, add an `essay` profile), or a PDF through the scan. 86a and 86b can run in parallel.                                                                                       | `src/server/modules/entries/`: `domain/file-kinds.ts` already lists the kinds; limits live in `domain/upload-rules.ts`.                                                                                                                                                         |
| [#87](https://github.com/SiddharthMuramkar/friends-of-animals/issues/87)          | #75, #85                   | Under "all participants" scope, a coordinator submits and replaces entries for their confirmed students through the same entries use cases. A coordinator roster (each student, entry status, next action), conduct certification once per institution registration (audited), and `requireConductCertified` for 89b.                                                                                                                                                                                                                                                                 | add a coordinator path to `src/server/modules/entries/use-cases/start-entry-upload.ts`, `src/server/modules/registration/enrolment.ts`. #87 unblocks #89, which starts the school-round chain (#89 → #90, #91, #92 → all of M3).                                                |
| [#106](https://github.com/SiddharthMuramkar/friends-of-animals/issues/106)        | #105                       | **106a**: a Donations module (`donor`, `donation`, `receipt`, `receipt_sequence`, `receipt_link`); payment batches gain a `purpose` (`registration_fee` or `donation`) so captures reach donations; ledger postings; receipt numbering. **106b**: the `/donate` form, checkout, thank-you, receipt pages and `/admin/donations`. Unblocks #107, #108, #110.                                                                                                                                                                                                                           | Post to the ledger like payments do: `src/server/modules/ledger/sources/payments.ts`, `src/server/modules/ledger/consumers.ts`. Gateway: [Payment gateway](#payment-gateway).                                                                                                   |
| [#109](https://github.com/SiddharthMuramkar/friends-of-animals/issues/109)        | #60, #105                  | **109a**: `ledger_period` and `finance_approval` (enums with all values up front); a trigger refusing postings on or before the lock line; a generic two-approver mechanism for `period_lock`, `period_unlock`, `manual_entry`; automatic postings into a closed month become late adjustments; `/admin/ledger/periods`, `/admin/ledger/approvals`. **109b**: `budget`, budget vs actual, the accountant CSV export.                                                                                                                                                                  | `src/server/modules/ledger/domain/period.ts`, `src/server/modules/ledger/manual-entry.ts`.                                                                                                                                                                                      |
| [#115](https://github.com/SiddharthMuramkar/friends-of-animals/issues/115)        | #69, #81                   | **115a**: access, correction and erasure requests by a user or a guardian for a linked child; a grievance queue with due dates (`privacy.requestDueDays`, 30), overdue flags, assignment; role `grievance_officer`; `privacy_request` and notes; a daily overdue schedule. **115b**: the ZIP export behind a signed link, erasure preview and an idempotent erasure job that keeps financial records under their floor. Needs counsel's rulings (HR-30).                                                                                                                              | Beside `src/server/modules/privacy/`, reusing its inventory and retention policies.                                                                                                                                                                                             |
| [#123](https://github.com/SiddharthMuramkar/friends-of-animals/issues/123)        | #60, #81                   | A Volunteers module: a member applies (interests, availability, two declarations as consents). Under 14 refused; under 18 waits for a verified guardian; a community manager approves with step-up and grants the global `volunteer` role.                                                                                                                                                                                                                                                                                                                                            | Guardian rules: `src/server/modules/guardians/`. Role grants: `src/server/access/`.                                                                                                                                                                                             |
| [#127](https://github.com/SiddharthMuramkar/friends-of-animals/issues/127)        | #59, #63                   | A Directory module: `directory_listing` and `directory_listing_document`; register, update, withdraw a listing, upload documents, staff verification. Search by distance is #128. Unblocks #128 and #129.                                                                                                                                                                                                                                                                                                                                                                             | New `src/server/modules/directory/`; uploads through `src/server/modules/files/`.                                                                                                                                                                                               |
| [#126](https://github.com/SiddharthMuramkar/friends-of-animals/issues/126)        | #64, #69                   | Campaign messages to consented segments. **The old unit plan made #119 (community membership) its blocker**, and #119 is not ready. Decide what a segment is before you start.                                                                                                                                                                                                                                                                                                                                                                                                        | Consent: `src/server/modules/consent/`. Delivery: `src/server/modules/notifications/`.                                                                                                                                                                                          |

Good order for one agent: 84b and 87 first (they keep the M2 → M3 path moving toward the pilot), then 86, then 106 and 109, then 115.

The old unit briefs (acceptance criteria, design options) are in git history before the cleanup, for example `git show 818cb442:docs/handoff/2026-11-21/units/84b/brief.md`. Their branch and worktree names are stale.

### Still blocked by unfinished tickets

| Ticket                 | Waiting on                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| #89                    | #87                                                              |
| #90, #91, #92          | #89                                                              |
| #93, #95               | #92 (#95 also needs #88, done)                                   |
| #94                    | #93                                                              |
| #96                    | #95                                                              |
| #97                    | #94, #96                                                         |
| #98, #99               | #97                                                              |
| #100-#104              | #99, and each other: #101, #102 ← #100; #103 ← #102; #104 ← #103 |
| #107, #108, #110       | #106 (#110 also #109)                                            |
| #117                   | #92, #93, #99 (GitHub also lists #73 and #80, both closed)       |
| #119                   | #99                                                              |
| #120, #121, #122, #125 | #119                                                             |
| #124                   | #123, #100                                                       |
| #128, #129 → #130      | #127                                                             |
| #131 → #132 → #133     | #94 (#133 also #105, done)                                       |
| #134                   | #99                                                              |
| #135                   | #117                                                             |

### Tickets blocked on owner items

IDs are from the [HR register](#hr-register-open-items).

**A decision is needed before or while building:**

| Ticket                            | Owner item                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| #115 Privacy rights requests      | HR-30: counsel's DPDP rulings (parental consent method, audit retention versus erasure, withdrawal SLA) |
| #120 Post-competition invitations | HR-58: go or no-go, and the backfill for the pilot cohort                                               |
| #128 Directory search by distance | HR-59: pin-code data licence and import; HR-60: the `earthdistance` extension, if needed                |
| #131 Auction lots                 | HR-63: may minors' work be auctioned, and the creator's share                                           |
| #133 Auction payment              | HR-64: the accountant's ruling on auction GST and payouts                                               |

**Code can be built, but production stays off until the owner acts:**

| Ticket                               | Owner item                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| #80, #106, #107                      | HR-15 Razorpay live KYC and keys; HR-34 refund and fee defaults                                              |
| #105, #106, #108, #109               | HR-47 the accountant's chart of accounts, receipts, export; HR-16 12A/80G for #108                           |
| #81, #82, #83 and every minors' flow | HR-32 safeguarding sign-off, HR-33 legal copy                                                                |
| #84 SMS, #58                         | HR-14 DLT registration through MSG91                                                                         |
| #85, #86, #63 uploads                | HR-13 FOA's R2 account; HR-35 worker-media                                                                   |
| #114, #116                           | HR-31 retention periods; HR-48 M5 safeguarding sign-off; HR-49 breach channel and on-call; HR-50 notice copy |
| #95                                  | HR-38 police checks for judges; HR-39 judge conduct copy                                                     |
| #100, #102, #124                     | HR-42, HR-43 certificate and logo-stamping design sign-off                                                   |
| #121, #123                           | HR-55 M6 safeguarding sign-off (and HR-38 for volunteers)                                                    |

## Architecture

The platform has two halves that share one Postgres database and talk only through it.

- **The website runs on Vercel.** One Next.js app: pages, Server Actions and API route handlers, in region `bom1` (Mumbai). Vercel serves only output that GitHub Actions built (ADR 0001).
- **The background half runs on a VPS** (`/srv/foa`, Docker Compose): Postgres, PgBouncer, the worker, ClamAV, Gotenberg, Caddy, Umami and GlitchTip.

The website writes a change and an **outbox** row in one transaction. The worker picks up the outbox row and does the slow or risky follow-up: sending email, scanning files, posting to the ledger.

```text
Browser ──► Vercel (Next.js app, region bom1)
              │  pages, Server Actions, /api/* route handlers
              │  as(actor).useCase(input)
              ▼
            PgBouncer :6432 (transaction mode) ──► pg-prod (Postgres 18)  ◄── worker-prod (direct, not PgBouncer)
                                                                               │ relay: outbox ► handlers
                                                                               │ pg-boss: nightly schedules
                                                                               ├─► clamd (ClamAV) for upload scans
                                                                               ├─► R2 (files), SES/MSG91 (messages)
                                                                               └─► heartbeat row ► GET /api/health/worker
```

### Stack

All versions are pinned exactly in `package.json`.

| Layer                    | Tool and version                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime, package manager | Node 26.x, pnpm 12.21.0                                                                                                                                                                          |
| Framework                | Next.js 16.4.6 (App Router, `cacheComponents`, `output: "standalone"`), React 19.3.0. Read `AGENTS.md`: this Next.js differs from older versions; its docs are in `node_modules/next/dist/docs/` |
| Language                 | TypeScript 7.0.2                                                                                                                                                                                 |
| Database                 | Postgres 18.7, Drizzle ORM 0.45.4 with the `postgres` 4.1.1 driver, drizzle-kit 0.31.11                                                                                                          |
| Sign-in                  | Better Auth 1.7.26, @simplewebauthn 14 (passkeys)                                                                                                                                                |
| Validation               | Zod 4.6.7                                                                                                                                                                                        |
| Background jobs          | The app's own outbox, plus pg-boss 12.38.2 for schedules only                                                                                                                                    |
| UI                       | Tailwind CSS 4.3.5, lucide-react, `class-variance-authority`, own components in `src/components/`                                                                                                |
| i18n                     | next-intl 4.15.1                                                                                                                                                                                 |
| Images                   | sharp 0.35.5, heic-decode 2.1.0                                                                                                                                                                  |
| Files, email             | AWS SDK v3 (S3 client for Cloudflare R2, SES v2)                                                                                                                                                 |
| Errors                   | @sentry/nextjs and @sentry/node 11.15.0, sending to self-hosted GlitchTip                                                                                                                        |
| Tests                    | Vitest 5.1.0 with PGlite 0.5.16, Playwright 1.65.1 with axe                                                                                                                                      |
| Lint, format             | oxlint 1.94.0 (type-aware), oxfmt 0.79.0                                                                                                                                                         |

### Decisions (ADRs)

| ADR                                                           | Decision                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [0001](docs/adr/0001-ci-e2e-and-prebuilt-deploys.md)          | CI runs E2E on its own Postgres; production deploys are prebuilt by GitHub Actions; no Vercel previews or staging               |
| [0002](docs/adr/0002-module-layout.md)                        | Server code splits into foundations and domain modules                                                                          |
| [0003](docs/adr/0003-labelled-ai-illustrations.md)            | AI illustrations are labelled                                                                                                   |
| [0004](docs/adr/0004-entry-status-values-up-front.md)         | The entry status enum holds every value from the start (see [Rule F2](#rule-f2-a-new-enum-value-ships-before-anything-uses-it)) |
| [0005](docs/adr/0005-better-auth-behind-identity.md)          | Better Auth sits behind `identity/`                                                                                             |
| [0006](docs/adr/0006-encrypted-phones-and-foa-phone-codes.md) | Phones are encrypted; phone codes are FOA's own                                                                                 |
| [0007](docs/adr/0007-append-only-audit-log.md)                | The audit log is append-only                                                                                                    |
| [0008](docs/adr/0008-outbox-is-the-delivery-queue.md)         | The outbox is the delivery queue; pg-boss runs schedules only                                                                   |
| [0009](docs/adr/0009-consent-is-an-event-log.md)              | Consent is an event log                                                                                                         |

### Module layout

ADR 0002 splits server code into **foundations** and **domain modules**. It decides only where code lives and sets no import rule. Foundations do import modules: `access/can.ts` uses `modules/second-factor`, `outbox/handlers.ts` calls each module's handlers, and `identity/create-account.ts` records sign-up consent (ADR 0009).

Foundations live in `src/server/`:

| Folder           | What it owns                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `identity/`      | Accounts, sign-in codes (email and phone), sessions. The only code that imports Better Auth.   |
| `access/`        | Roles, grants, `can()`/`authorize()`, the platform policy, the super admin bootstrap.          |
| `audit/`         | `recordAudit()` and the audit log search.                                                      |
| `outbox/`        | Domain events, `emit()`, the relay, the retry policy, queues and pg-boss `SCHEDULES`.          |
| `mailbox/`       | Reading the capture mailbox over HTTP (never in production).                                   |
| `observability/` | The server error reporter, the `/monitoring` tunnel, worker health.                            |
| `ports/`         | Interfaces to outside services and their adapters ([Ports and adapters](#ports-and-adapters)). |
| `seed/`          | Seed builders and seed data for local databases and tests.                                     |
| `db/`            | The Drizzle client, database URL rules, and every table in `db/schema/`.                       |
| `crypto/`        | The field cipher, blind indexes and link tokens.                                               |
| `rich-text/`     | The one sanitiser for CMS and post bodies. A helper, not a domain module.                      |

Domain modules live in `src/server/modules/<name>/`. Each usually has `index.ts` (its use cases), `policy.ts` (who may call them), a pure `domain/` folder, a `testing.ts` of test helpers, and tests beside the code. They are listed in [Domain modules](#domain-modules).

### Composition root

Every read or write that runs domain logic goes through one call: `as(actor).someUseCase(input)`.

- `src/server/actor.ts` defines the **Actor**: a `visitor`, a `user` (with `userId` and `sessionId`), or `system` (`seed`, `worker` or `cli`). Visitors and users carry the request's IP and user agent.
- `src/server/deps.ts` defines `Deps`: the database, the clock and every port. `productionDeps()` builds them once from `env()`.
- `src/server/use-cases.ts` has `composeUseCases()`. Each module exports a function from context to named use cases. Two modules with the same use-case name fail type-checking.
- `src/server/app.ts` composes every foundation's and module's set. `createApp(deps)` returns `{ as(actor) }`; `as(actor)` is the production shortcut. `currentActor()` reads the session cookie and returns this request's Actor.

Tests use the same entry point with a fresh PGlite database and fakes ([Seam 1](#seam-1-use-case-tests-through-the-harness)).

### Request flow

```mermaid
flowchart TD
  B[Browser] --> H["next.config.ts headers()<br/>security headers, public CSP, noindex outside production"]
  H --> M{"matched by src/proxy.ts?"}
  M -- "signed-in tree, /consent/*,<br/>/blog/:slug, /competitions/:slug" --> P["src/request-proxy.ts<br/>no session cookie: redirect to /sign-in<br/>unknown slug: 404<br/>signed-in page: per-request nonce CSP"]
  M -- other paths --> R
  P --> R["Page (Server Component), Server Action or /api route handler"]
  R --> A["as(await currentActor()).useCase(input)"]
  A --> C["authorize(): can() reads grants from the DB<br/>+ second factor for staff roles / step-up"]
  C --> Z["zod parse: { ok: false, error: 'invalid_input' }"]
  Z --> T["db.transaction: write rows<br/>+ recordAudit() + emit() outbox rows"]
  T --> DB[(Postgres via PgBouncer)]
  DB -. "outbox rows" .-> W["worker relay: claim, run handler, retry"]
  W --> X["SES, MSG91, R2, clamd, Razorpay, ledger"]
```

1. **Headers.** `next.config.ts` adds security headers to every response (`src/lib/security-headers.ts`). Public pages get a CSP without a nonce (`src/lib/csp.ts`). Outside production every response gets `X-Robots-Tag: noindex, nofollow`. These are fixed at build time, so `APP_ENV` must be set for `next build`.
2. **Proxy.** Next 16 renamed middleware to "proxy". `src/proxy.ts` lists the paths it runs on; the logic is in `src/request-proxy.ts`. It sends visitors without a session cookie to `/sign-in`, returns a real 404 for unknown blog and competition slugs, and gives signed-in pages a strict CSP with a per-request nonce. It does not check the session itself; the page does.
3. **Page or action.** Pages, Server Actions (`"use server"` files, usually `src/app/**/_lib/actions.ts`) and route handlers call `as(actor)`. Staff pages also sit behind the second-factor gate in `src/app/(staff)/layout.tsx`.
4. **Use case.** It calls `authorize(ctx, "<action>")`, then parses input with Zod and returns `invalid_input` with the bad field names (`src/server/input.ts`), then writes inside `ctx.db.transaction`. `recordAudit()` and `emit()` take the same transaction, so the change, its audit row and its outbox rows commit together or not at all. A refused action throws `DomainError` (`forbidden`, `enrolment_required`, `second_factor_required`, `step_up_required`; `src/server/errors.ts`). Expected outcomes, like a wrong code, are returned as results.

### Ports and adapters

A **port** is an interface to an outside service; an **adapter** implements it. `deps.ts` and the worker pick the adapter from `APP_ENV` and from which keys are set.

| Port (`src/server/ports/`)            | Adapters                                                  | How one is picked                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| email                                 | SES, capture, unconfigured                                | `email-sender-for.ts`: outside production always capture. Production uses SES when `SES_*` are set, otherwise every send is refused.                                                      |
| sms                                   | MSG91, capture, unconfigured                              | `sms-sender-for.ts`: same rule with `MSG91_*`.                                                                                                                                            |
| storage                               | R2, local disk                                            | `storage-for.ts`: R2 when `R2_*` are set. A local run without R2 uses disk, served by `/api/local-storage`.                                                                               |
| malware-scanner                       | clamd, local, unconfigured                                | `scannerFor()` in `deps.ts`: clamd when `CLAMD_HOST` is set. A local run without R2 uses a stand-in that flags only the EICAR test file. Vercel never reaches clamd, so the worker scans. |
| payment-gateway                       | Razorpay, fallback (test checkout), unconfigured          | `payment-gateway-select.ts` ([Payment gateway](#payment-gateway)).                                                                                                                        |
| media                                 | sharp                                                     | Only worker-media has it. The app gets `unconfiguredMedia`.                                                                                                                               |
| errors                                | Sentry SDK                                                | Silent without a DSN.                                                                                                                                                                     |
| copy-bucket                           | S3 API                                                    | The off-site copy (R2 to B2).                                                                                                                                                             |
| clock, cookies, settings, human-check | system clock, Next cookies, settings table, proof of work | Always the same.                                                                                                                                                                          |

Each port has a `*.contract.ts` suite. The real adapter and its fake in `src/test/fakes/` both pass it, so the fake stays faithful.

### Sign-in, sessions and the second factor

- **Better Auth sits behind `identity/`** (ADR 0005). No `/api/auth/*` route is mounted. Better Auth makes, hashes, expires and counts email codes and owns database sessions. FOA owns the rate limits (in Postgres), sends codes itself through the email port, and creates accounts itself.
- **Email codes:** 6 digits, valid 10 minutes, 5 wrong guesses (`identity/settings.ts`). Limits: 5 per address per 15 minutes, 20 per IP network per 15 minutes, 20 per address per day. Local runs allow 200 per IP. Codes are sent straight from the app, not through the outbox.
- **Phone codes are FOA's own** (ADR 0006). Phones are stored encrypted, so Better Auth's phone plugin can't be used. A verified phone starts its session through a server-only Better Auth endpoint.
- **Sessions** last 30 days and are never extended by activity. Staff sessions are capped by the `auth.staffSessionHours` setting (12 by default).
- **Second factor:** staff roles must enrol a TOTP app or a passkey and pass it once per session ([`second-factor`](#second-factor)). **Step-up** means passing it again within the last 10 minutes. Actions marked `stepUp(...)` in a policy need it: granting and revoking roles, changing settings, resetting a second factor, setting fees, deciding refunds.
- **Switches:** the settings `auth.emailSignIn` (on by default) and `sms.enabled` (off until DLT). In production email sign-in is also forced off until SES is configured and `SES_PRODUCTION_ACCESS=true` (`emailSignInReady()` in `deps.ts`). That is why `/sign-in` shows "Sign-in opens soon" today.

### Roles and permissions

- `access/domain/roles.ts` lists 17 roles and 4 scope types (`global`, `institution`, `competition`, `organisation`). A **grant** is one role at one scope. `ROLE_SCOPE_TYPES` limits which scopes each role may have.
- **Staff roles:** `staff_admin`, `super_admin`, `competition_manager`, `content_manager`, `community_manager`, `finance`, `auction_manager`, `adoption_coordinator`, `safeguarding_lead`. All need the second factor. Other roles include `institution_admin`, `institution_coordinator` and `guardian`.
- `access/policies.ts` joins every module's `policy.ts` into one `POLICY`, one rule per action. **Super admin is not a wildcard**: each rule names its roles, and only `safeguarding_lead` can read safeguarding reports.
- `access/can.ts` reads the user's grants from the database on every call, so a grant or revoke takes effect at once.
- The first super admin comes from the command line ([Making the first super admin](#making-the-first-super-admin)). Later grants are made at `/admin/roles`.

### Audit log

`recordAudit()` (`src/server/audit/record.ts`) writes one row in the same transaction as the change: who acted, with which role, the entity, before and after (ids and changed fields only), and the IP and user agent. `drizzle/0005_59_audit_append_only.sql` adds triggers that refuse UPDATE, DELETE and TRUNCATE and revokes those rights (ADR 0007). Staff read the log at `/admin/audit`. Audit rows count as behaviour in tests.

### Outbox, relay, schedules and workers

- **Emit.** `emit(tx, clock, event)` (`outbox/emit.ts`) checks the payload against `EVENT_PAYLOADS` and inserts one outbox row per handler listed in `SUBSCRIBERS` (`outbox/events.ts`). Handlers are registered in `outbox/handlers.ts`. `availableAt` delays a row.
- **Relay.** `outbox/relay.ts` claims due rows with a 5-minute lease, runs the handler, and settles the row. The default policy makes 5 attempts (waits of 30 s, 1, 2 and 4 minutes), then marks the row `failed` and keeps it for staff (`outbox/retry-policy.ts`). Delivery is at least once, so **handlers must be safe to repeat**. Times come from the injected clock, so tests drive retries.
- **Queues.** The `media` queue (`files.process_image`) is drained only by worker-media. Every other handler runs in the default worker (`outbox/queues.ts`).
- **Schedules.** pg-boss runs only recurring jobs (ADR 0008). `SCHEDULES` (`outbox/schedules.ts`) lists them, in Asia/Kolkata time; see [Worker jobs and schedules](#worker-jobs-and-schedules).
- **Worker processes.** `src/worker/main.ts` (`pnpm worker`, Docker target `worker`) drains every 5 s. `single` mode serves one database; `preview` mode (dormant) serves every preview database. `src/worker-media/main.ts` (Docker target `worker-media`) makes image derivatives in a child process with a hard timeout (`MEDIA_TIMEOUT_SECONDS`, default 60). `docker/workers.yml` defines `worker-prod`, `worker-staging`, `worker-preview` and `worker-media`; **only `worker-prod` runs** ([The VPS](#the-vps)).
- **Health.** The worker writes a `worker_heartbeat` row and touches `/tmp/foa-worker-heartbeat` after each poll. Docker's health check reads the file. `GET /api/health/worker` reads the row and answers 503 once it is older than 120 s.

### Files pipeline

1. `POST /api/files/presign` runs `requestUpload`. It checks the file's purpose, type and size and returns a presigned PUT URL to `<prefix>incoming/<id>`.
2. The browser PUTs the bytes straight to R2 (or local disk). They never pass through a Vercel function.
3. `POST /api/files/[id]/complete` runs `completeUpload`. It checks the stored object, moves it to its final key (which no upload URL names), and emits `files.file_uploaded`.
4. The worker's `files.scan_file` handler streams the object once into clamd, a SHA-256 hash and a type sniffer. The outcome is **clean**, **quarantined** (moved to `<prefix>quarantine/<id>`, audited, never served) or **rejected** (bytes don't match the declared type; the object is deleted). The scan fails closed: with no verdict the file stays `scanning` and only its uploader can open it.
5. Clean images emit `files.processing_requested`. worker-media makes **derivatives**: rotated upright, resized, location and camera data removed. Entries and blog images follow these events.
6. Delivery: `getFileDownloadUrl` checks `can()` and the file's status, then returns a signed GET URL valid for 5 minutes. Files are never public, except post images copied to the public bucket.

Gotenberg (HTML or Office to PDF) runs on the VPS and `docker/workers.yml` gives worker-media its URL, but no code calls it yet.

### Notifications pipeline

Producers never send messages themselves. They emit a domain event, and the `notifications.dispatch` handler looks up **message routes** (database rows) for that event. For each recipient it reads contacts, **channel choices**, consent for News and updates, and the `sms.enabled` setting. Then it renders the **message template** (wording staff edit at `/admin/templates`) and delivers in-app (an inbox row), by email or by SMS (`modules/notifications/dispatch.ts`). A unique key on (event, template, recipient, channel) stops a message going twice. Recipients without an account (principals, invitees, contact-form senders, announcement contacts) go through their own handlers or `contact-delivery.ts`. Outside production every email and SMS lands in the **capture mailbox** table instead ([Signing in locally](#signing-in-locally)).

### Payment gateway

The `payment-gateway` port has a Razorpay adapter (`ports/razorpay/`) and a fallback with a built-in **test checkout**. `payment-gateway-select.ts` picks one:

| `APP_ENV`  | Razorpay keys     | Adapter                             |
| ---------- | ----------------- | ----------------------------------- |
| production | `rzp_live_`       | Razorpay                            |
| production | test keys or none | none: every payment is refused      |
| other      | `rzp_test_`       | Razorpay in test mode               |
| other      | `rzp_live_`       | none: real money only in production |
| other      | none              | fallback with the test checkout     |

`POST /api/webhooks/razorpay` receives webhooks. The proxy does not match `/api`, so there is no session check there; the signature authorises it. Every signal (the Checkout return or a webhook) is checked against the gateway's own record of the order before anything is confirmed. Refunds go out from the worker. Captures and refunds are posted to the ledger by outbox handlers. Details: [`payments`](#payments), [`ledger`](#ledger).

### Field encryption and blind indexes

`src/server/crypto/field-cipher.ts` encrypts personal-data columns with AES-256-GCM, a fresh IV per value and the column name bound in. Stored values look like `v<version>:<iv>:<ciphertext>:<tag>`. Keys come from the versioned ring `FIELD_ENCRYPTION_KEYS`. A **blind index** (`blind-index.ts`) is an HMAC-SHA-256 of the normalised value under `FIELD_HMAC_KEY`, so a row can be found (for example a user by phone) without storing the value readably. Staging and production refuse to start without both keys; other environments fall back to public development keys (`crypto/keys.ts`). `link-token.ts` makes 256-bit link tokens and stores only their SHA-256 hash. Column rules are in [Encrypted columns and the data inventory](#encrypted-columns-and-the-data-inventory); key handling is in [The field-key rule](#the-field-key-rule).

### Observability

- **Errors.** The Sentry SDK sends to GlitchTip at `errors.friendsofanimals.dev`. The server reports through `src/instrumentation.ts` (`onRequestError`). The browser loads the SDK only on the first error and posts to the same-origin tunnel `POST /monitoring`. The worker uses `@sentry/node` with `SENTRY_DSN`. `src/lib/observability/scrub.ts` removes emails, phones, names, bodies, cookies and query strings everywhere.
- **CSP reports** go to `POST /api/csp-report`. Each becomes one scrubbed log line; nothing is stored. Staging and production send the CSP **Report-Only**; local runs enforce it.
- **Analytics.** Umami is cookieless. Only staging and production send page views, never from signed-in, sign-in, sign-up or token pages. `next.config.ts` rewrites `/stats/script.js` and `/stats/api/send` to `UMAMI_ORIGIN` only when it is set at build time.
- **Logs.** Vercel keeps its own logs (no drain yet, HR-24). On the VPS every container logs to journald, kept one year.

### Internationalisation

next-intl runs without locale routing. One locale, `en-IN`, time zone `Asia/Kolkata` (`src/i18n/`). UI strings are JSON files per area in `messages/en-IN/`. oxlint's `react/jsx-no-literals` rule (`.oxlintrc.json`) fails any literal string in `src/**/*.tsx`, including `alt`, `aria-label`, `title` and `placeholder`; tests are exempt. New pages add their own messages file.

### `APP_ENV`

`APP_ENV` (`src/env.schema.ts`) is the one switch for environment behaviour; never use `VERCEL_ENV`. Only `production` is deployed. `local` is used for development and CI. `preview` and `staging` still have code paths but no deployment or worker.

| Behaviour                                         | local                 | preview      | staging      | production                               |
| ------------------------------------------------- | --------------------- | ------------ | ------------ | ---------------------------------------- |
| Email and SMS                                     | capture               | capture      | capture      | SES / MSG91, or refused without keys     |
| Capture mailbox and drain APIs                    | with token            | with token   | mailbox only | 404                                      |
| CSP                                               | enforced              | enforced     | Report-Only  | Report-Only                              |
| `noindex`                                         | yes                   | yes          | yes          | no (indexable, HSTS `includeSubDomains`) |
| Field keys, `BETTER_AUTH_SECRET`                  | dev defaults          | dev defaults | required     | required (and a Sentry DSN)              |
| `pnpm db:seed`                                    | yes (local host only) | yes          | refused      | refused                                  |
| Code and contact rate limits per IP               | loose                 | loose        | normal       | normal                                   |
| Guardian flows, consent links                     | on                    | on           | off          | off                                      |
| Paper consent forms (`consent_form` file purpose) | on                    | on           | on           | off                                      |
| `/account/files` demo, test upload purposes       | on                    | on           | on           | 404 / refused                            |
| Sample content placeholders                       | shown                 | shown        | shown        | hidden                                   |
| Umami, off-site copy                              | off                   | off          | Umami only   | both                                     |

## Domain modules

Each module lives in `src/server/modules/<name>/` and follows the layout in [Module layout](#module-layout). Each entry below lists:

- **Tables** it writes (`src/server/db/schema/<file>.ts`).
- **Use cases** that `as(actor)` exposes (from `index.ts`).
- **Who may call** (from `policy.ts`; roles in [Roles and permissions](#roles-and-permissions); `stepUp(...)` means a second factor passed in the last 10 minutes).
- **Pages** under `src/app/` that call them.
- **Events** it emits (`src/server/outbox/events.ts`). The handler for each is in [Worker jobs and schedules](#worker-jobs-and-schedules).

### Modules at a glance

| Module                                  | Purpose                                                                                                                        | Tickets                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| [`announcements`](#announcements)       | A competition manager writes, previews and sends an announcement to a competition's registrants                                | #84                     |
| [`breaches`](#breaches)                 | The staff breach log, its timeline, and notices to affected people and the authority                                           | #116                    |
| [`cms`](#cms)                           | Editable site documents with drafts and published revisions, and blog posts                                                    | #111, #112              |
| [`codes`](#codes)                       | Human-facing codes such as the Institution ID `FOA-I-8H3TZ`. Helper, no use cases                                              | #73                     |
| [`competitions`](#competitions)         | Create, publish, list and cancel competitions; status jobs and guards; fees, award schemes, pinned consent versions (`terms/`) | #70, #71, #72, #80, #88 |
| [`consent`](#consent)                   | Versioned consent documents and the consent event log, for adults and for a guardian's child                                   | #64, #82                |
| [`consent-forms`](#consent-forms)       | A school uploads signed paper consent forms; FOA staff review them                                                             | #83                     |
| [`consent-links`](#consent-links)       | A school sends a guardian a consent link answered after a one-time code                                                        | #83                     |
| [`contact`](#contact)                   | The public contact form and the staff contact inbox                                                                            | #113                    |
| [`entries`](#entries)                   | A participant's entry in a competition and its uploaded picture                                                                | #85                     |
| [`files`](#files)                       | Uploads, the malware scan, image derivatives, signed delivery                                                                  | #63, #85                |
| [`guardians`](#guardians)               | Guardians, the children they manage, teen logins, guardian requests                                                            | #81                     |
| [`institutions`](#institutions)         | Institution registration and verification; coordinator invitations (`coordinators/`)                                           | #73, #74                |
| [`judging`](#judging)                   | Rubrics per discipline, the school-judging guard, the judging guide                                                            | #88                     |
| [`ledger`](#ledger)                     | Double-entry postings for payments and refunds, manual entries, reversals                                                      | #105                    |
| [`notifications`](#notifications)       | Message templates and routes, dispatch, the in-app inbox, channel choices                                                      | #69                     |
| [`offsite-copy`](#offsite-copy)         | The nightly copy of production files from R2 to Backblaze B2, and the restore                                                  | #68                     |
| [`participants`](#participants)         | The individual route: an adult, or a guardian for a child, registers and pays                                                  | #78, #81                |
| [`payments`](#payments)                 | Payment batches, Checkout, the gateway webhook, offline payments, review cases, refunds                                        | #77, #79, #80           |
| [`privacy`](#privacy)                   | The data inventory, its admin page, the retention sweep and legal holds                                                        | #114                    |
| [`privacy/requests`](#privacy-requests) | Rights requests (access, correction, erasure), the grievance queue, data exports and erasure                                   | #115                    |
| [`public-forms`](#public-forms)         | Shared guards for public forms: proof-of-work human check, per-sender rate limits                                              | #113                    |
| [`registration`](#registration)         | An institution registers for a competition and enrols students, one by one or from CSV; confirmation after payment             | #75, #76, #77           |
| [`reminders`](#reminders)               | Named reminders before a deadline, to whoever still owes it when each one runs                                                 | #84                     |
| [`safeguarding`](#safeguarding)         | The public "report a concern" form and the safeguarding lead's queue                                                           | #116                    |
| [`second-factor`](#second-factor)       | Staff TOTP and passkeys, step-up, staff session lifetimes                                                                      | #60                     |
| [`settings`](#settings)                 | Runtime settings a super admin changes without a deploy                                                                        | #62                     |

### announcements

A competition manager writes, previews and sends an announcement to a competition's confirmed registrants (84a-1 audience, 84a-2 delivery).

- **Recipient selection** (`load-audience.ts`, `domain/audience.ts`): coordinators, participants and guardians (a minor's message goes to the guardian). Each address gets one delivery per channel. Shared with [`reminders`](#reminders), which passes the registrations that owe a deadline; `delivery-plan.ts` (`loadRosterDeliveryPlan`) and `roster-delivery.ts` (`deliverToRoster`) are shared the same way.
- **Table** `announcement` (`src/server/db/schema/announcements.ts`): structured plain-text sections, never HTML; encrypted help contacts; `status` `draft` or `sent`; `revision` for optimistic edits; `sent_by`, `sent_at` and `recipient_count` stamped on send (check `announcement_sent_stamped`). Who received it is in `message_delivery`.
- **States** (`domain/status.ts`): `draft` → `sent`, final. A correction is a new announcement.
- **Use cases:** `createAnnouncement`, `updateAnnouncement`, `getAnnouncement`, `listAnnouncements`, `previewAnnouncement`, `sendAnnouncement`.
- **Who may call:** `announcement.manage`, a competition manager for that competition or one with a global grant.
- **Pages:** `/admin/competitions/[id]/announcements`, `.../new`, `.../[announcementId]`.
- **Events:** `competition.announcement_sent` → `announcements.fan_out` (`fan-out.ts`), which plans the audience again at send time, then delivers in-app through `notifications/dispatch.ts` and by email or SMS through `notifications/contact-delivery.ts`. The worker gained a `blindIndex` dependency for this.
- **Migrations:** `0068_84_pre_enum_message_delivery` (adds `sending`, rule F2), `0069_84_announcements`, `0070_84_announcement_messages`.
- **Tests:** `announcements-*.test.ts`, `domain/*.test.ts`, `tests/e2e/84-announcements.spec.ts`.

### breaches

The personal-data breach log (#116b).

- **Tables** (`src/server/db/schema/breaches.ts`): `breach_record` (status, severity `critical`/`high`/`medium`/`low`, containment and notice stamps), `breach_timeline_event` (append-only by trigger, `drizzle/*_116_breach_timeline_append_only.sql`), `breach_notification`, `breach_fan_out` (cursor of the paged fan-out), `breach_unreachable` (who couldn't be told, and why).
- **States** (`domain/breach-status.ts`): `open` → `contained` or `notified`; `contained` → `notified` or `closed`; `notified` → `closed` (a `contain` there only stamps the time); `closed` is final. Closing from `contained` needs a no-notice reason and nothing pending; closing from `notified` needs containment.
- **Use cases** (`use-cases.ts`): `recordBreach`, `updateBreach`, `addBreachTimelineEvent`, `containBreach`, `listBreaches`, `getBreach` (super admin, staff admin); `notifyAffectedUsers`, `notifyAuthority`, `closeBreach` (the same, with step-up).
- **Pages:** `/admin/breaches`, `/admin/breaches/[id]`.
- **Events:** `breach.fan_out_requested` → `breaches.fan_out` (one page of accounts per delivery, next cursor saved in the same transaction); `breach.principal_notice` → `notifications.dispatch` (audience `breach_recipient`); `breach.authority_notice` → `breaches.send_authority_notice`.
- **Authority notice:** emailed only when the setting `breach.authorityEmail` is set, which waits for counsel (HR-49). Until then staff file it by hand and record the authority's reference (stored encrypted, `authority.ts`).
- **Retention:** kept while open and 5 years after closing (`retention-policy.ts`, HR-31). The retention sweep runs it as `BREACH_RECORDS` (`privacy/policies/module-owned.ts`): a closed breach is deleted 5 years after closing unless its lead or a timeline author is under a legal hold.
- **Tests:** `breach-log.test.ts`, `notify.test.ts`, `notify.pg.test.ts`, `authority.test.ts`, `authority.pg.test.ts`, `policy.test.ts`, `retention-policy.test.ts`; E2E `116-breach-log.spec.ts`.

### cms

Content documents and revisions (#111) and posts (#112).

- **Tables:** `cms_document`, `cms_revision` (`src/server/db/schema/cms.ts`); `cms_post`, `cms_post_image` (`posts.ts`).
- **Documents** (`domain/documents.ts`): `home`, `about`, `impact`, `site_facts`, `legal_privacy`, `legal_terms`, `legal_safeguarding`, `legal_child_protection`.
- **Post states** (`domain/post-status.ts`): `draft` → `scheduled` → `published` → `archived`; `draft` → `published` (publish now); `scheduled` → `draft`; `archived` → `draft`. A scheduled post shows publicly from its instant even if the job runs late (`isPostPublic`).
- **Use cases:**

  | Group           | Use cases                                                                                                                                                                                           | Who may call                              |
  | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
  | Documents       | `listCmsDocuments`, `listRevisions`, `saveDraft`, `publishRevision`, `getDraftForPreview`, `startPreview`                                                                                           | content manager                           |
  | Public reads    | `getPublishedDocument`, `currentLegalVersion`, `getOrgFacts`, `listPublishedPosts`, `latestPublishedPosts`, `getPublishedPostBySlug`, `publishedPostSlugs`, `nextPostGoingLive`                     | anyone                                    |
  | Facts readiness | `orgFactsReadiness`, `getOrgFactsForPreview`                                                                                                                                                        | staff admin, super admin, content manager |
  | Posts           | `checkPostWriter`, `createPost`, `updatePost`, `getPostForEdit`, `listPosts`, `uploadPostImage`, `describePostImage`, `schedulePost`, `unschedulePost`, `publishPost`, `archivePost`, `restorePost` | content manager                           |

- **Pages:** staff `/admin/cms`, `/admin/cms/[key]`, `/admin/blog`, `/admin/blog/new`, `/admin/blog/[id]`; public `/`, `/about`, `/impact`, `/blog`, `/blog/[slug]`, the legal pages, `sitemap.ts`. Public pages read through `cached.ts` with cache tags.
- **Events:** `cms.post_scheduled` (delayed to the publish instant) → `cms.publish_scheduled_post`; `files.file_processed` → `cms.publish_post_image` (copies derivatives to the public bucket); `cms.post_published` goes to dispatch, but no route sends anything yet.
- **Open:** FOA's org facts (HR-21, `facts.ts`); how posts and stories differ on screen (HR-51).
- **Tests:** `publishing.test.ts`, `posts/*.test.ts`, `posts/slug-race.pg.test.ts`, `cached.test.ts`, `tests/e2e/111-cms.spec.ts`, `tests/e2e/112-blog*.spec.ts`.

### codes

Random human-facing codes: a fixed prefix plus Crockford base32 symbols without I, L, O or U (`codes.ts`). No tables, no use cases. Exports `generateCode`, `withUniqueCode` (retries on a unique-constraint clash) and `INSTITUTION_CODE`. Internal ids stay UUIDv7; a code is never derived from personal data.

| Code                   | Format                              | File                                                        |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Institution ID         | `FOA-I-` + 5                        | `codes/codes.ts`                                            |
| Registration reference | `{comp}-I-` + 5                     | `registration/domain/institution-registration-reference.ts` |
| Registration number    | `{comp}-R-` + 6                     | `registration/domain/registration-number.ts`                |
| Participant ID         | `FOA-P-{YY}` + 6                    | `participants/domain/participant-code.ts`                   |
| Entry ID               | `{comp}-E-` + 6                     | `entries/domain/entry-code.ts`                              |
| Safeguarding reference | `SG-{YY}-` + 6                      | `safeguarding/domain/reference.ts`                          |
| Contact reference      | `CM-{YY}-` + 6 (not checked unique) | `contact/reference.ts`                                      |

### competitions

Competitions and their status; `terms/` holds fees, award schemes and pinned consent versions.

- **Tables:** `competition`, `competition_age_group`, `competition_category`, `competition_key_date` (`competitions.ts`); `competition_transition_block` (`competition-transitions.ts`); `competition_fee`, `competition_award_scheme`, `competition_consent_document` (`competition-terms.ts`); cancellation columns `cancelled_at`, `cancel_reason` and the `competition_cancellation_email` table (80b).
- **Use cases:** `createCompetition`, `getCompetitionForEdit`, `updateCompetition`, `listCompetitionsForAdmin`, `previewCompetition`, `publishCompetition`, `listPublishedCompetitions`, `getPublishedCompetition`, `publishedCompetitionSlugs`, `advanceCompetitionStatus`, `listCompetitionsForCancellation`, `cancelCompetition`, `getCompetitionCancellation`. Terms: `getCompetitionTermsForEdit`, `setCompetitionFees`, `setRoundAwards`, `attachConsentDocument`, `detachConsentDocument`, `getCompetitionDocumentVersion`.
- **States** (`domain/status-machine.ts`):

  | From                                                                               | To (cause)                                                                  |
  | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
  | `draft`                                                                            | `published` (manager)                                                       |
  | `published`                                                                        | `registration_open` (schedule, at `registration_opens`)                     |
  | `registration_open`                                                                | `registration_closed` (schedule, at `registration_closes`)                  |
  | `registration_closed`                                                              | `school_judging` (schedule, at `submissions_close`; guarded)                |
  | `draft`, `published`, `registration_open`, `registration_closed`, `school_judging` | `cancelled` (cause `cancellation`; final)                                   |
  | `school_judging`                                                                   | only `cancelled` so far. Later tickets add FOA judging, results and archive |

- **Rules:**
  - The code is 3 to 6 letters plus a two-digit year, for example `PAWS27` (`domain/code.ts`). Publishing refuses until `domain/publish-rules.ts` finds no problems.
  - **Status jobs:** publishing saves one `competitions.key_date_scheduled` event per key date. A job whose date has moved finds itself stale and does nothing (`status-jobs.ts`, `advance-status.ts`).
  - **Guards:** a scheduled move blocked by a guard records one open `competition_transition_block` row and tells the managers; each guard's `retryOn` events retry it (`transition-guards.ts`). The only guard so far is judging's rubric check.
  - **Fees** are bigint paise and lock once registration opens. **Award schemes:** `ranked_123`, `medals_gsb` or `grades_ab`, per round (`school`, `foa_final`).
  - **Pins:** a competition pins one published version per attachable consent purpose. A newer version changes nothing until a manager re-attaches (`domain/consent-attachments.ts`).
  - **Cancelling** (80b): one transaction locks the competition and plans with `domain/cancellation.ts`; supersedes discretionary refunds still `requested` or `failed`; starts one system `cancellation` refund per paid batch (`startSystemRefund`); cancels unpaid and free registrations and open batches; tells families and coordinators. A paid registration stays `confirmed` until its refund is back (`cancel-competition.ts`).
- **Who may call:** create, edit, preview, publish: `competition_manager`. Read published: anyone. `competition.advance_status`: the worker only. Set fees: `stepUp(competition_manager)`. `competition.cancel`: `stepUp(super_admin)` only (HR-34); `competition.cancel.read`: `super_admin`.
- **Pages:** staff `/admin/competitions`, `.../new`, `.../[id]/edit`, `.../[id]/preview`, `.../[id]/terms`, `.../[id]/cancel`, `.../[id]/rubrics`, `.../[id]/announcements`; public `/competitions`, `/competitions/[slug]`, `/documents/[purpose]/[version]`.
- **Events:** `competitions.key_date_scheduled`, `competition.transition_blocked`, `competition.disciplines_changed`, `registration.competition_cancelled`, `institution_registration.competition_cancelled`; `competition.published`, `competition.key_dates_changed` (a published one's dates edited) and `competition.cancelled`, each → `reminders.schedule` (#84).
- **Tests:** `create.test.ts`, `publish.test.ts`, `status-jobs.test.ts`, `transition-guards.test.ts`, `cancel-competition.test.ts`, `cancel-competition.pg.test.ts`, `terms/fees.test.ts`; E2E `70-competitions-*.spec.ts`, `72-competition-terms.spec.ts`, `80-cancel-competition.spec.ts`.

### consent

Versioned consent documents, and consent as an event log (ADR 0009).

- **Tables** (`consent.ts`): `consent_document` (published versions; `drizzle/0012_64_consent_document_immutable.sql` refuses UPDATE, DELETE, TRUNCATE) and `consent_event` (`given` or `withdrawn`).
- **Purposes** (`domain/purposes.ts`): `privacy_notice`, `terms`, `messages`, `competition_terms`, and the guardian purposes `participation`, `public_display`, `display_school`, `display_city`, `social_media`, `auction`, `communications`. Methods: `web_form`, `otp_link`, `paper_form`, `staff_recorded`. An adult can give only `messages` themselves.
- **Use cases:** `previewConsentDocument`, `publishConsentDocument`, `currentConsentDocument`, `listConsentDocumentVersions`, `giveConsent`, `withdrawConsent`, `myConsents`, `childConsents`, `giveChildConsent`, `withdrawChildConsent`, `childConsentHistory`. Not use cases (callers authorize first): `recordSignUpConsent`, `recordRegistrationConsents`, the participation-gate helpers.
- **Rules:** a consent's state is its latest event; a call that changes nothing appends nothing. Publishing inserts the next version; a published version is never edited. **Participation gate:** a minor takes part only with the guardian's participation consent on the competition's attached version; giving it moves a `pending_guardian` registration to `pending_payment` in the same transaction (`participation-gate.ts`, gated by `guardianFlowsActive`).
- **Who may call:** publish and list versions: staff admin, super admin. Current version: anyone. Own consents: signed in. `consent.child.*`: the child's guardian.
- **Pages:** `/admin/consent-documents`, `/account/consents`, `/guardian/children/[id]/consents` (and `/history`), `/documents/[purpose]/[version]`, the sign-up messages box.
- **Events:** `consent.withdrawn`. **Open:** legal copy (HR-20, HR-33). Production has no consent versions until staff publish version 1.
- **Tests:** `consent.test.ts`, `documents.test.ts`, `child-consent.test.ts`, `participation-gate.test.ts`, `participation-gate.pg.test.ts`; E2E `64-consent.spec.ts`, `82-guardian-consent.spec.ts`.

### consent-forms

School paper consent: a coordinator uploads a scan of a form a guardian signed; FOA staff accept or reject it. Only an accepted form counts as consent.

- **Tables** (`consent-forms.ts`): `consent_form_upload`, `consent_form` (statuses `pending_review`, `accepted`, `rejected`, `withdrawn`; rejection reasons `illegible`, `not_signed`, `wrong_student`, `wrong_competition`, `uses_unclear`, `other`). The participation declaration sits on `institution_registration.participation_declared_at`.
- **Use cases:** `requestConsentFormUpload`, `submitConsentForm`, `withdrawConsentForm`, `reviewConsentForm`, `declareParticipation`, `listSignedFormsForRegistration`, `listConsentFormsForReview`, `getConsentFormForReview`.
- **Rules** (`domain/review.ts`): no submit while a form for that student is pending or when a ticked use was not offered; staff can't review their own upload; accepting needs a clean file; rejecting needs a reason, and `other` a note of up to 500 characters.
- **Who may call:** submit, withdraw, declare: coordinator. Read: staff admin, super admin. Review: `stepUp(staff_admin or super_admin)`.
- **Pages:** `/institution/registrations/[ref]/consents`; staff `/admin/consent-forms`, `/admin/consent-forms/[id]`.
- **Events:** `consent.form_reviewed`. **Gated:** the `consent_form` file purpose is non-production, so this is dormant in production (HR-32, HR-33).
- **Tests:** `submit.test.ts`, `review.test.ts`, `queue.test.ts`; E2E `83-signed-form-consent.spec.ts`.

### consent-links

School link consent: a coordinator sends a link to the guardian contact the school holds. The guardian asks for a one-time code, enters it, then gives or declines each public use. No account needed.

- **Table:** `consent_link` (channel `email` or `sms`; status `pending`, `used`, `revoked`; "expired" is read from `expiresAt`, never stored).
- **Use cases:** `sendConsentLink`, `revokeConsentLink`, `answerConsentLink`, `sendConsentLinkCode`, `verifyConsentLinkCode`, `listStudentConsents`, `viewConsentLink`.
- **Rules** (`domain/link.ts`): a link lasts 7 days, a code 10 minutes; 5 code attempts and 5 sends, 1-minute resend cooldown; 30 minutes to answer after the code; one answer uses the link up. The code is stored as a keyed digest.
- **Who may call:** send, revoke, list: coordinator or institution admin. View, code, verify, answer: whoever holds the link.
- **Pages:** `/institution/registrations/[ref]/consents`, public `/consent/[token]`.
- **Events:** `consent.link_sent` → `consent_links.deliver`. **Gated:** `consentLinksActive()` is true only in `local` and `preview` (`repository.ts`).
- **Tests:** `send-link.test.ts`, `answer-link.test.ts`, `answer-link.pg.test.ts`, `verify-link.test.ts`; E2E `83-code-link-consent.spec.ts`.

### contact

The public contact form, routed by topic to a staff team, and the staff inbox.

- **Tables** (`contact.ts`): `contact_message`, `contact_note` (append-only, `drizzle/0025_113_contact_note_append_only.sql`).
- **Use cases:** `submitContactMessage`, `listContactInbox`, `getContactMessage`, `assignContactMessage`, `changeContactMessageStatus`, `addContactNote`.
- **States** (`domain/status.ts`): `new` → `in_progress` or `closed`; `in_progress` → `closed`; `closed` → `in_progress`. Closing needs a reason: `resolved`, `no_action_needed`, `spam` or `duplicate`.
- **Rules:** seven topics, each routed to a staff role (`DEFAULT_CONTACT_ROUTING`, defaults until FOA confirms); the team is stored on the message. Submitting checks fields, spends the human check, runs the bot screen (`MIN_FILL_MS = 3000`) and takes the sender's allowances in one transaction ([`public-forms`](#public-forms)). The acknowledgement holds only the reference and topic, never the sender's words (anti-relay). Messages are kept 24 months after closing (retention sweep).
- **Who may call:** anyone may submit. The inbox: super admin or a team role (`staff_admin`, `competition_manager`, `community_manager`, `adoption_coordinator`, `finance`, `content_manager`); staff admin and super admin see every team.
- **Pages:** `/contact`; staff `/admin/inbox`, `/admin/inbox/[id]`. **Events:** `contact_message.received`. **Open:** acknowledgement wording (HR-50).
- **Tests:** `submit.test.ts`, `inbox.test.ts`, `acknowledge.test.ts`; E2E `113-contact-inbox.spec.ts`.

### entries

An **Entry** is the work one confirmed individual registration submits for a competition. A registration has at most one Entry. Its first completed upload creates the row and the **Entry ID**. Later uploads retry a failed first file or replace the **live file**. The words travel with the file: there is no draft. Why every status value exists before any judging uses it: ADR 0004.

- **Tables** (`entries.ts`): `entry`, `entry_file` (kind `image`, `video`, `document` or `text`), `entry_upload_grant`, `entry_transition`.
- **Use cases:** `startEntryUpload`, `completeEntryUpload`, `listMyEntries`, `getEntry`, `getEntryUploadOptions`, `listCompetitionEntries`. The worker applies scan and derivative results in `apply-file-outcome.ts`.
- **Pages:** `/participant/entries`, `/participant/entries/new`, `/participant/entries/[code]`, and links on `/participant` (PR #268). The upload flow is grant → PUT → complete and recovers when a grant's answer is lost (`src/app/participant/entries/_lib/upload-flow.ts`). No page calls `listCompetitionEntries` yet.

**Who may act:**

| Action                       | Who                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `entry.submit`, `entry.read` | The registration's owner. A verified guardian with an active link owns their ward's registration; a linked teen owns their own. |
| `entry.list_mine`            | Any signed-in member; the list holds only their own entries and their wards'.                                                   |
| `entry.list_competition`     | A competition manager for that competition, or a global one (second factor required).                                           |

Only `route = individual` registrations qualify; institution registrations fail the owner check until #87. The registration must be `confirmed` (`registration_not_confirmed`). A guardian-owned minor profile needs participation consent (`participation_consent_required`); on staging and production `guardianFlowsActive` is false, so that check refuses even with consent on file.

**Two calls:**

```ts
const started = await as(actor).startEntryUpload({
  registrationId,
  discipline, // optional; see below
  file: { name: "bowl.heic", type: "", size: 1_800_000 },
});
if (!started.ok) return started;
// PUT the bytes to started.uploadUrl with started.headers, before expiresAt.
const done = await as(actor).completeEntryUpload({
  registrationId,
  fileId: started.fileId,
  title: "Water bowl",
  description: "A clay bowl left on the lane.",
  statement: "", // optional
});
// done: { ok: true, entryCode, status: "processing" } until the checks finish
```

`startEntryUpload` checks the file, the window and the registration, then presigns a private `entry_image` upload; the Entry is unchanged until `completeEntryUpload`. Completing the same `fileId` again returns the Entry as it stands. `getEntryUploadOptions` serves only the first-upload form; once an Entry exists it returns `entry_exists` with its code.

**Discipline** is chosen with the first upload and stays fixed: the Entry's current one, else the requested one if the competition offers it and it is a picture discipline, else the competition's only picture discipline. Picture disciplines: `drawing`, `painting`, `art`, `craft`, `photography` (`rules.ts`). Essay and videography have no rule yet (#86), so they are refused (`discipline_not_offered`, `discipline_required`).

**File rules:** `DEFAULT_IMAGE_RULE` in `domain/upload-rules.ts` (until FOA sets limits, HR-37): JPEG, PNG, WebP, HEIC, HEIF; 1 byte to 20 MiB. `checkUpload` refuses `empty`, then `wrong_type`, then `too_large`. An empty or `application/octet-stream` type falls back to the file name's extension (how a phone HEIC gets through); `completeEntryUpload` checks the stored type without that fallback. After a clean scan, media work makes `thumb_320` and `display_1600`; `getEntry` shows the large one through a short-lived signed URL.

**Window:** opens at `registration_opens`, closes at `submissions_close` (open instant included, close excluded). A missing date means `submission_not_open`. The upload counts when `completeEntryUpload` succeeds; scans and derivatives may finish after the close.

**One Entry, three actions** (`decideUpload` in `domain/submission.ts`):

| Situation                   | Action    | Entry status after complete                          |
| --------------------------- | --------- | ---------------------------------------------------- |
| No row yet                  | `create`  | `processing`, with a new Entry ID                    |
| `rejected` or `failed`      | `retry`   | back to `processing`                                 |
| `processing` or `submitted` | `replace` | unchanged; the new file is a **pending replacement** |

Any other status returns `entry_locked`. A new upload supersedes any file still `pending` or `processing`; the live file stays until the new one is `live`. Text limits (`domain/entry-text.ts`): title 120, description 500, statement 1,500, after trim; title and description required. A replacement's words wait on the file as `pendingText` and move onto the Entry only when it goes live.

**Statuses.** Files: `pending` → `processing` (clean scan) → `live` (derivatives ready); bad scan `pending` → `rejected`; unopenable `processing` → `failed`; replaced → `superseded`. At most one file per Entry is `live`. Entries:

| From                 | To           | When                             |
| -------------------- | ------------ | -------------------------------- |
| new                  | `processing` | first upload completed           |
| `processing`         | `submitted`  | first file becomes live          |
| `processing`         | `rejected`   | first file fails the virus check |
| `processing`         | `failed`     | first file cannot be processed   |
| `rejected`, `failed` | `processing` | the participant retries          |

The enum already has `school_shortlisted`, `not_shortlisted`, `submitted_to_foa`, `foa_verified` and `sent_back`; no move reaches them yet. Each move writes a history row. Outcomes that arrive late, twice, or for a dropped file change nothing.

**Who sees what:** `listMyEntries` returns the member's and their wards' entries, newest first, with `checking` while an upload is in flight. `getEntry({ code })` is for the participant, linked teen or guardian; another person's code and an unknown code both throw forbidden. `listCompetitionEntries` (staff) omits `processing`, `rejected` and `failed` and does not include who made the work.

**Notices** (routes in `drizzle/0066_85_entry_messages.sql`; email and in-app; SMS waits for HR-14; wording for HR-36):

| Event                 | When                                           | Adult template            | Guardian template                  |
| --------------------- | ---------------------------------------------- | ------------------------- | ---------------------------------- |
| `entry.submitted`     | first file becomes live                        | `entry.received`          | `entry.received.guardian`          |
| `entry.file_rejected` | virus check failed (also on replacement)       | `entry.file_rejected`     | `entry.file_rejected.guardian`     |
| `entry.file_failed`   | file could not be opened (also on replacement) | `entry.processing_failed` | `entry.processing_failed.guardian` |

A replacement that goes live emits no event.

**Refusals.** `startEntryUpload`: `registration_not_confirmed`, `participation_consent_required`, `discipline_not_offered`, `discipline_required`, `empty`, `wrong_type`, `too_large`, `submission_not_open`, `deadline_passed`, `entry_locked`, `upload_limit`. `completeEntryUpload` adds `file_not_found`, `upload_missing` (PUT, then complete again) and `upload_rejected` (storage held something else and deleted it). Both return `invalid_input` for a bad body.

**Upload grants** (`upload-grants.ts`): at most 3 unfinished uploads per uploader, 6 grants per uploader in the window, one unfinished grant per registration. Pass `replacesFileId` or `restartPendingUpload: true` to retire the current grant and take its slot. Each grant schedules its own expiry and a sweep of the staged object an hour later.

- **Tests:** `domain/status.test.ts`, `domain/submission.test.ts`, `domain/upload-rules.test.ts`, `use-cases/submit-entry.test.ts`, `use-cases/entry-outcomes.test.ts`, `use-cases/replace-entry-file.test.ts`, `use-cases/entry-authz.test.ts`, `use-cases/complete-entry-upload.pg.test.ts`, `src/app/participant/entries/_lib/upload-flow.test.ts`; E2E `85-entries.spec.ts`.

### files

Uploads, the scan, derivatives and signed delivery. The steps are in [Files pipeline](#files-pipeline).

- **Tables:** `file_asset` (`files.ts`); `file_processing`, `file_derivative` (`media.ts`).
- **Purposes** (`domain/purposes.ts`): `test_upload` 10 MiB (not production), `cms_image` 20 MiB, `offline_payment_proof` 10 MiB, `entry_image` 20 MiB, `consent_form` 10 MiB (not production).
- **File states** (`domain/file-status.ts`): `pending_upload` → `uploaded` (or `rejected`) → `scanning` → `clean`, `quarantined` or `rejected`; any → `deleted`. `quarantined`, `rejected` and `deleted` never come back.
- **Use cases:** `requestUpload` (any signed-in user), `completeUpload` (the uploader), `getFileDownloadUrl` (uploader, staff admin, super admin, plus the status gate), `getFileStatus` (uploader), `getFileDerivativeUrl` (no page caller yet). Other modules also use the files domain directly: entries' upload grants, `cms/posts/images.ts`, consent forms, offline payment proofs.
- **Routes:** `/api/files/presign`, `/api/files/[id]/complete`, `/api/files/[id]`; the `/account/files` demo outside production.
- **Gaps:** worker-media isn't running in production, so no derivatives are made. Quarantined files are removed by the retention sweep (flagged by `file_asset.quarantine_purge_pending`), except files an `entry_file`, `consent_form`, `file_processing`, `file_derivative` or `offline_payment` row still names; a quarantined payment proof is kept with its payment.
- **Tests:** `upload.test.ts`, `scan-handler.test.ts`, `scan-retry.test.ts`, `process-image.test.ts`, `delivery.test.ts`, `src/worker-media/process-media.test.ts`; E2E `63-files.spec.ts`.

### guardians

A member declares they are a child's parent or lawful guardian and verifies by code, then adds children.

- **Tables** (`guardians.ts`): `guardian` (declaration, `verification_method` `email_otp` or `phone_otp`), `guardian_link`, `guardian_invitation` (`teen_login` or `guardian_request`; `pending`, `accepted`, `revoked`).
- **Use cases:** `registerAsGuardian`, `myGuardianProfile`, `startGuardianVerification`, `confirmGuardianVerification`, `addChild`, `listChildren`, `getChild`, `inviteTeenLogin`, `withdrawTeenInvitation`, `viewTeenInvitation`, `acceptTeenInvitation`, `myGuardians`, `viewGuardianRequest`, `acceptGuardianRequest`.
- **Rules:** verification sends a code to the member's own verified email (directly, not through the outbox) and grants the global `guardian` role; a verified record is fixed. A child under 13 gets a guardian-managed profile with no login; 13 to 17 can be invited to their own login (`MINOR_LOGIN_MIN_AGE`). A **guardian request**: a teen with no guardian names one by email; the link lasts 7 days and is accepted only by a verified guardian with that address. A child's login can never hold guardian, staff, school or judge roles.
- **Who may call:** register and own list: signed in. Manage children: `guardian` (and owner of the child). Viewing an invitation or request: anyone with the link.
- **Pages:** `/guardian`, `/guardian/register`, `/guardian/children/new`, `/guardian/children/[id]`, `/invitations/[token]`.
- **Events:** `guardian.teen_invited`, `guardian.guardian_requested`. **Gated:** off in production and staging (`availability.ts`, `guardianFlowsActive`; E2E `55-guardian-launch-pause.spec.ts`). SMS waits for HR-14.
- **Tests:** `children.test.ts`, `verify-guardian.test.ts`, `teen-login.test.ts`, `claim-child.pg.test.ts`; E2E `81-guardians.spec.ts`.

### institutions

An authorised person registers an institution; FOA staff verify it; the authorised person invites coordinators.

- **Tables:** `institution` (`institutions.ts`; `pending_verification`, `verified`, `rejected`, `suspended`); `institution_invitation` (`institution-invitations.ts`; channel `email` or `phone`).
- **Use cases:** `registerInstitution`, `getMyInstitution`, `listInstitutions`, `getInstitutionForReview`, `decideInstitution`; coordinators: `inviteCoordinator`, `viewInvitation`, `acceptInvitation`, `listCoordinators`, `removeCoordinator`, `revokeInvitation`.
- **States** (`domain/status.ts`): `pending_verification` → `verified` or `rejected`; `verified` → `suspended`; `suspended` → `verified` (reinstated, keeps its ID); `rejected` final. Every decision needs a reason (up to 1,000 characters).
- **Rules:** one open registration per person. The first verification assigns the Institution ID and makes the authorised person `institution_admin`. An invitation lasts 7 days; re-inviting withdraws the earlier link; accepting needs an account whose verified email or phone was invited. `institution.created_by` (the authorised person) is `NOT NULL` with no `ON DELETE`, so that user row can't be deleted while the institution exists.
- **Who may call:** register, view own: signed in. List, review, decide: staff admin, super admin. Manage coordinators: `institution_admin`. `institution.coordinate` (used by registration, payments, consent): coordinator or admin at that institution.
- **Pages:** `/institutions/register`, `/institution`, `/institution/coordinators`, `/invitations/[token]`; staff `/admin/institutions`, `/admin/institutions/[id]`.
- **Events:** `institution.verified`, `.rejected`, `.suspended`, `.reinstated`, `institution.coordinator_invited`.
- **Tests:** `register.test.ts`, `decide.test.ts`, `coordinators/*.test.ts`; E2E `73-institutions.spec.ts`, `74-institution-coordinators.spec.ts`.

### judging

Rubrics per discipline, the guard that keeps a competition out of school judging until its rubrics are published, and the judging guide.

- **Tables** (`judging.ts`): `rubric` (`draft`, `published`, `superseded`), `rubric_criterion`. `drizzle/0034_88_rubric_immutability.sql` freezes a rubric once it leaves draft (`rubric_not_editable`).
- **Use cases:** `createRubricDraft`, `updateRubricDraft`, `publishRubric`, `startRubricRevision`, `listRubrics`, `getDisciplineRubrics`, `getJudgingGuide`, `listJudgingGuides`.
- **Rules:** publishing needs criteria whose weights total 100; each criterion is scored 0 to 10 (HR-37). A newer version supersedes the old. No rubric changes once the competition is in school judging. **Guard:** every discipline needs a published rubric before `registration_closed` → `school_judging`.
- **Who may call:** manage and list rubrics: `competition_manager`. Read the guide: coordinator or institution admin.
- **Pages:** `/admin/competitions/[id]/rubrics`, `.../rubrics/[discipline]`, `/institution/competitions/[code]/judging-guide`, the guide list on `/dashboard`.
- **Events:** `rubric.published` (retries a blocked move). **Missing:** scoring, shortlisting and judges (#89 onward).
- **Tests:** `rubrics.test.ts`, `judging-guide.test.ts`, `school-judging-rerun.test.ts`; E2E `88-rubrics.spec.ts`.

### ledger

FOA's double-entry books (#105).

- **Tables** (`ledger.ts`): `ledger_account` (chart of accounts), `ledger_posting` (unique `seq`; unique (`source_type`, `source_id`)), `ledger_line`. `drizzle/0059_105_ledger_guards.sql` adds triggers: UPDATE, DELETE, TRUNCATE fail on postings and lines; at COMMIT each posting must have its declared line count and equal debits and credits. It also seeds the chart.
- **Chart** (`domain/chart.ts`): system accounts `1000` Bank, `1010` Cash, `1100` Gateway clearing, `3000` Accumulated fund, `4100` Registration fees. Others are editable. The accountant must confirm codes and names (HR-47).
- **Use cases:** `listPostings`, `getPosting`, `listLedgerAccounts` (finance, `ledger.read`); `createManualEntry`, `reversePosting`, `createLedgerAccount`, `updateLedgerAccount`, `deactivateLedgerAccount` (finance, `ledger.write`); `postPaymentCapture`, `postRefund`, `backfillLedgerFromPayments` (worker, seed or CLI only). Only manual entries can be reversed.
- **Pages:** `/admin/ledger`, `/admin/ledger/[seq]`, `/admin/ledger/accounts`, `/admin/ledger/entries/new`.
- **Money rules:** paise `bigint`; typed rupees parsed digit by digit, never through a float, up to Rs 100 crore per line. Periods are IST calendar months. A capture debits the asset account for its method (gateway → clearing, cash → cash, cheque or transfer → bank) and credits `4100`; a refund mirrors its capture and never exceeds it. One posting per source: a replay returns `duplicate`.
- **Jobs:** `ledger.post_capture` on `payment.batch_captured`; `ledger.post_refund` on `refund.processed`; nightly `ledger.reconcile_payments` posts anything they missed.
- **Missing:** period lock (#109), transparency (#110), donation and auction sources.
- **Tests:** `finance-writes.test.ts`, `payment-postings.test.ts`, `refund-postings.pg.test.ts`, `backfill.test.ts`, `guards.test.ts`; E2E `105-ledger.spec.ts`.

### notifications

Message templates, message routes, dispatch, the inbox and channel choices (#69). Transport rules: [Notifications pipeline](#notifications-pipeline).

- **Tables** (`notifications.ts`): `message_template` (per key, channel, locale, versioned), `message_route` (event, template, audience, channels, whether the law requires it), `message_delivery` (one per message per channel; unique on event, template, recipient, channel; `user_id` nullable, with a blind-index `contact_hash` for contacts without accounts), `inbox_item`, `notification_preference`.
- Default templates and routes are data, inserted by custom migrations (for example `drizzle/0019_69_notification_defaults.sql`). There is no admin page for routes; a route changes only through a migration.
- **Use cases:** `listMessageTemplates`, `getMessageTemplate`, `updateMessageTemplate` (content manager, super admin); `listInbox`, `countUnread`, `markInboxItemRead`, `markAllInboxRead`, `getNotificationPreferences`, `updateNotificationPreferences` (any signed-in user, own rows).
- **Pages:** `/admin/templates`, `/admin/templates/[key]`, `/account/inbox`, `/account/notifications`, the inbox badge.
- **Delivery states:** `pending`, `sending` (claimed by compare-and-set in `contact-delivery.ts`), `sent`, `failed`, `suppressed`. Suppression reasons: `preference_off`, `consent_withdrawn`, `sms_disabled`, `sms_unregistered`, `no_contact`, `no_guardian`. A `failed` row retries with its outbox delivery.
- **Audiences** (`audiences.ts`): `subject_user`, `individual_payer`, `registration_owner`, `guardian_of_participant`, `contact_sender`, `family_contact`, `contact_team`, `safeguarding_leads`, `competition_managers`, `finance_team`, `breach_recipient`, `announcement_registrants`, `announcement_contacts`, `reminder_registrants`, `reminder_contacts`, plus the cancellation audiences.
- **Gaps:** see [Code gaps](#code-gaps) (no idempotency key on email and SMS ports; worker refuses outbox email and SMS in production). SMS needs DLT template ids (HR-14).
- **Tests:** `dispatch.test.ts`, `inbox.test.ts`, `templates.test.ts`, `channels.test.ts`; E2E `69-messages.spec.ts`.

### offsite-copy

The nightly copy of production R2 files to Backblaze B2, and the restore (#68). No use cases and no policy.

- **Table:** `offsite_copy`, the manifest (one row per copied object with etag, size and when it left R2). Losing it is safe: the next run copies everything again and never purges a copy it has no row for.
- **Entry points:** the schedule `offsite_copy` (`schedule.ts`) and `pnpm offsite:restore --bucket <bucket> --key <key>` (`scripts/offsite-restore.ts`).
- **Schedule:** 01:30 IST (an hour before the database backup), 3 retries, 3-hour expiry. Does nothing outside production; in production missing settings throw and report on the final attempt.
- **Settings:** see [Worker-only variables](#worker-only-variables).
- **Safety** (`domain/plan.ts`): if R2 lists no objects while B2 holds live copies, the run refuses (`empty_listing`). Marking more than 10% (and at least 10) raises `OffsiteMassDeletionWarning`.
- **State:** not configured in production (HR-25).
- **Tests:** `run-copy.test.ts`, `restore.test.ts`, `schedule.test.ts`, `config.test.ts`; live contract in [Live contracts](#live-contracts-pnpm-testlive).

### participants

The individual route: an adult registers and pays for themselves, and a guardian or teen does the same for a minor.

- **Tables:** none of its own; writes `participant_profile` and `registration` (`registration.ts`) and payment batches.
- **Use cases:** `registerAsIndividual`, `payForMyRegistration`, `confirmMyPayment`, `payMyTestCheckout`, `listMyRegistrations`, `hasMyRegistrations`, `individualRegistrationForm`.
- **Rules:** the first registration makes a profile with a **Participant ID** `FOA-P-{YY}` + 6 (never a sign-in credential). A stored date of birth is fixed. Adult means 18 or over on India's calendar. A minor's registration starts `pending_guardian`, then waits for payment; payment also needs participation consent. Paying makes a payment batch of one at the individual fee; a fee of 0 confirms at once; only the gateway's own record confirms a payment. `payMyTestCheckout` works only with the fallback gateway.
- **Who may call:** create and list own: signed-in member. Pay: the registration's profile owner.
- **Pages:** `/participant/register/[slug]`, `/participant/registrations/[id]/pay`, `/participant` (dashboard). **Gated:** minor flows only where `guardianFlowsActive()`.
- **Tests:** `register-as-individual.test.ts`, `register-minor.test.ts`, `register-while-accepted.pg.test.ts`, `pay-for-my-registration.test.ts`; E2E `78-individual-registration.spec.ts`, `81-minor-registration.spec.ts`.

### payments

Payment batches, Checkout, the gateway webhook, offline payments, payments needing review, and refunds (`refunds/`). Gateway selection: [Payment gateway](#payment-gateway).

**Tables** (`payments.ts`, `refunds.ts`, `payment-test-gateway.ts`):

| Table                                       | Holds                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `payment_batch`                             | One gateway order: total in paise, status, capture method (`gateway` or `offline`). Never deleted.           |
| `payment_batch_item`                        | One registration's fee in a batch. A partial unique index lets only one live batch hold a registration.      |
| `gateway_webhook_event`                     | One row per webhook, keyed by gateway and event id. No body stored (it carries the payer's email and phone). |
| `offline_payment`                           | A cheque, transfer or cash that finance recorded, with reference and proof file. One per batch.              |
| `payment_review_case`                       | One per captured payment the batch couldn't accept.                                                          |
| `refund`, `refund_item`                     | A refund and the registrations it covers. Only one live refund per item.                                     |
| `gateway_test_order`, `_payment`, `_refund` | The fallback test checkout only.                                                                             |

**Use cases:**

| Use case                                                                                              | Who may call (action)                                            | Page                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `payInstitutionFees`, `confirmCheckout`, `payTestCheckout`, `getFeesToPay`, `getPaymentBatch`         | coordinator, institution admin (`payments.pay`, `payments.read`) | `/institution/registrations/[ref]/pay`, `.../payments/[batchId]`                        |
| `receiveGatewayWebhook`                                                                               | anyone; the signature authorises it                              | `/api/webhooks/razorpay`                                                                |
| `requestOfflinePaymentProofUpload`, `recordOfflinePayment`                                            | finance, staff admin, super admin + step-up                      | `/admin/payments/batches/[id]`                                                          |
| `listPaymentReviewCases`, `getPaymentReviewCase`, `getPaymentBatchForStaff`, `getOfflinePaymentProof` | money staff                                                      | `/admin/payments/review`, `/admin/payments/review/[id]`, `/admin/payments/batches/[id]` |
| `resolvePaymentReviewCase`, `recordDashboardRefund`                                                   | money staff + step-up                                            | `/admin/payments/review/[id]`                                                           |
| `requestRefund`                                                                                       | competition manager, staff admin, super admin                    | `/admin/payments/batches/[id]/refund`                                                   |
| `approveRefund`, `rejectRefund`, `retryRefund`, `recordManualRefund`                                  | finance only + step-up                                           | `/admin/refunds/[id]`                                                                   |
| `listRefunds`, `getRefund`, `getRefundableBatch`                                                      | finance, staff admin, super admin, competition manager           | `/admin/refunds`                                                                        |

**Payment batch states** (`domain/batch-status.ts`):

| From                  | Event → new status                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created`             | `order_opened` → `order_created`; `order_refused` → `failed`; `superseded` or `competition_cancelled` → `cancelled`; `offline_recorded` → `captured` |
| `order_created`       | `captured` → `captured`; `superseded` or `competition_cancelled` → `cancelled`; `offline_recorded` → `captured`; `review_opened` → `needs_review`    |
| `captured`            | none. A paid batch stays paid; refunds are separate rows.                                                                                            |
| `failed`, `cancelled` | `review_opened` → `needs_review`                                                                                                                     |
| `needs_review`        | `review_confirmed` or `review_cleared` → `captured`; `review_dismissed` → `cancelled`                                                                |

**Refund states** (`domain/refund-status.ts`). Kinds: `discretionary` (starts `requested`), `cancellation` and `duplicate` (start `approved`).

| From                   | Event → new status                                                           |
| ---------------------- | ---------------------------------------------------------------------------- |
| `requested`            | `approved` → `approved`; `rejected` → `rejected`                             |
| `approved`             | `sent` → `processing`; `processed` → `refunded`; `gateway_failed` → `failed` |
| `processing`           | `processed` → `refunded`; `gateway_failed` → `failed`                        |
| `failed`               | `retried` → `approved`; `rejected` → `rejected`                              |
| `refunded`, `rejected` | none                                                                         |

Nobody may decide a refund they requested (`same_person`). Methods: `gateway`, or `manual` for a batch paid offline.

**Review cases** (`domain/review-case.ts`): reasons, in check order: `already_paid`, `registration_cancelled`, `amount_mismatch`, `registration_closed`, `batch_superseded`, `paid_while_in_review`, `participation_consent_required`. Outcomes `confirm`, `refund` or `keep`; `confirm` only when the reason allows it, the batch wasn't captured, the currency is INR and the amount positive. A resolution reason of 10 to 2,000 graphemes is required.

**Money rules:**

- Every amount is a positive `bigint` in paise (`amount_minor`). Refunds must be INR.
- **The gateway decides.** A Checkout return, a webhook or paying again only names a batch. `sync-batch.ts` reads the order's payments from the gateway and decides in one locked transaction (`domain/capture-decision.ts`). Known payment ids are never acted on again, so a batch is confirmed once and each payment reviewed once.
- **Webhooks:** the signature is checked in `src/server/ports/razorpay/webhook.ts`. A replayed event id answers `duplicate`. Refund events sync refunds (`refunds/sync-refund.ts`).
- **Refund idempotency:** every gateway refund goes through `sync-refund.ts` with an idempotency key of refund id and attempt number, plus notes naming both. If an answer is lost, the next run finds the refund by its notes and adopts it.
- `refund.dashboard_processed` tells the payer after finance records a dashboard refund of a receipt in another currency.

**Events:** `payment.batch_captured` (receipt and ledger), `refund.approved` → `refunds.send`, `refund.processed` (message and ledger), `refund.failed`.

**Missing:** a sweep that re-checks open batches against the gateway ([Code gaps](#code-gaps)).

- **Tests:** `receive-gateway-webhook.test.ts`, `review-detection.test.ts`, `resolve-review-case.test.ts`, `refunds/gateway-outcomes.test.ts`, `refunds/receipt-compatibility.pg.test.ts`, port contract `src/server/ports/payment-gateway.contract.ts`; E2E `77-*.spec.ts`, `79-offline-payments.spec.ts`, `80-refunds.spec.ts`.

### privacy

The data inventory, its admin page, the retention sweep and legal holds (#114).

- **Inventory** (`inventory.ts`, explained in [`docs/privacy/data-inventory.md`](docs/privacy/data-inventory.md)): each personal-data column with its purpose and retention period. Every period says `toConfirm: true` until counsel confirms (HR-31); financial records have an 8-year floor.
- **Coverage** (114-1, `domain/coverage.ts`): every schema column is classified exactly once, either as personal (category, owner, policy, and what happens on expiry: `delete_row`, `set_null`, `tombstone`, ...) or as not personal (`non-personal.ts`). **A new column fails `domain/coverage.test.ts` until you classify it.**
- **Use cases:** `getInventory` (super admin, staff admin); `runRetentionSweep` (worker or CLI); `previewRetentionSweep` (super admin); `placeLegalHold`, `releaseLegalHold` (super admin + step-up); `listLegalHolds` (super admin, staff admin).
- **Tables** (`privacy.ts`): `legal_hold`, `retention_run_progress`.
- **Sweep** (114-2): schedule `privacy.retention_sweep` at 02:15 IST. A policy registry (`policies/`) holds one policy per kind of record. The setting `retention.enforce` is **off by default**, so a run only counts; one `retention.<key>Days` setting per policy. It removes dispatched outbox rows, message deliveries, captured messages, quarantined files, expired sessions and verifications, old invitations, released holds, closed contact messages after 24 months, safeguarding reports after their period, and financial records after their floor. A legal hold stops a record being removed. The registry is `SWEPT_POLICIES` and `LIFECYCLE_POLICY_KEYS` in `policies/index.ts`; module-owned policies (safeguarding reports, `BREACH_RECORDS`) are in `policies/module-owned.ts`. `institution.created_by` and `offline_payment.proof_file_asset_id` stay `NOT NULL`, so the sweep never nulls them. Capture mailboxes no longer prune on send and verification cleanup is off: the sweep owns both, so wherever `retention.enforce` is off (staging included) captured messages and expired verifications pile up until a super admin turns it on.
- **Pages:** `/admin/privacy` (inventory, sweep preview and the legal-hold forms, `_components/hold-forms.tsx`).
- **Rights requests, export and erasure:** [`privacy/requests`](#privacy-requests) (#115).
- **Seed:** `src/server/seed/privacy.ts`.
- **Tests:** `inventory.test.ts`, `domain/coverage.test.ts`, `inventory-view.test.ts`, `sweep.test.ts`, `holds.test.ts`, `quarantined-files.test.ts`, `financial-retention.pg.test.ts`, `hold-session.pg.test.ts`; E2E `114-privacy-inventory.spec.ts`, `114-privacy.spec.ts`.

### privacy requests

Privacy rights requests and the grievance officer's queue (#115), in `src/server/modules/privacy/requests/`: a user, or a verified guardian for a linked child, asks for a copy of the data, a correction or an erasure; the **grievance officer** answers by the due date.

- **Tables** (`privacy-requests.ts`): `privacy_request` (reference `PR-{YY}-` + 6; type, status, relation, subject as `(subject_kind, subject_id)` with no foreign key so it outlives an erasure; correction details, refusal reason and resolution encrypted; export and erasure-approval columns), `privacy_request_note` (encrypted, never edited, never shown to the requester), `privacy_overdue_digest` (one row per IST day), `erasure_record` (ids only: subject, every account and profile covered, what was done with each kind of record, the latest date a kept kind lapses).
- **States** (`domain/request-status.ts`): `submitted` → `in_progress` (start, assign), `rejected`, `cancelled` (requester, only before work starts); `in_progress` → `completed` (a correction, an export), `partially_completed` (an erasure that kept something), `rejected`. Closed statuses are final.
- **Who files what** (`domain/filing.ts`): anyone signed in about themselves; a verified guardian about a linked child under 18; a teen (13 to 17) asks for access and correction, erasure goes through their guardian. One open request of each type per person (advisory lock, `submit.pg.test.ts`).
- **Use cases:** requester `submitPrivacyRequest`, `listMyPrivacyRequests`, `getMyPrivacyRequest`, `cancelPrivacyRequest`, `listPrivacyRequestSubjects`, `getPrivacyExportLink`; officer `listGrievanceQueue`, `getGrievanceRequest` (audited), `assignPrivacyRequest`, `startPrivacyRequest`, `addPrivacyRequestNote`, `rejectPrivacyRequest`, `completeCorrection`, `buildSubjectExport`, `previewErasure`, `executeErasure` (step-up); worker `flagOverduePrivacyRequests`.
- **Who may call** (`policy.ts`): a request is read by whoever filed it and the verified guardian of the child it is about; only whoever filed it cancels it or downloads its export (staff never do). Everything else is `grievance_officer` only (a global staff role; super admin is not a wildcard).
- **Export** (`subject-data/`): the worker collects every section of the person's data (`sections.ts`: rows decrypted, sign-in secrets and keyed hashes withheld; the ids of other rows naming them; their own uploads' bytes), checks each row is theirs (`guard.ts`), and stores a store-only ZIP (`zip.ts`) at `<prefix>privacy_export/<id>.zip`, outside the Files module. The link works for `privacy.exportLinkHours`, then a delayed job deletes the ZIP. `sections.test.ts` fails until a new table about a person is exported, referenced or left out with a reason.
- **Erasure** (`subject-data/erasure-plan.ts`, `erasure.ts`): the officer previews what is deleted, anonymised, withdrawn and kept (with the basis and until when), and approves that plan by its fingerprint; the worker re-plans and refuses a changed plan. Consents are withdrawn (method `staff_recorded`), entries and their files deleted, a profile with a paid registration anonymised, payments and consent evidence and the audit log kept, the account kept while a payment it made is under its 8-year floor (setting), everything kept under a legal hold. A deleted account's owner gets the `privacy_request.erased` email directly.
- **Settings:** `privacy.requestDueDays` (30), `privacy.erasureDueDays` (30), `privacy.exportLinkHours` (72), `privacy.erasureEnabled` (off; seeded on locally), `privacy.erasureKeepsPayerAccount` (on), `retention.privacyRequestsDays` (1095). All wait for counsel (HR-30).
- **Pages:** `/dashboard/privacy`, `/dashboard/privacy/new`, `/dashboard/privacy/[id]`; staff `/admin/privacy/requests`, `/admin/privacy/requests/[id]`.
- **Events:** `privacy_request.submitted`, `.rejected`, `.completed`, `.overdue_digest` → `notifications.dispatch` (audiences `privacy_requester`, `grievance_officers`, `grievance_digest`); `privacy_request.export_requested` → `privacy.build_export`; `privacy_request.export_expired` (delayed) → `privacy.expire_export`; `privacy_request.erasure_approved` → `privacy.execute_erasure`.
- **Migrations:** `0081_115_pre_enum_role_grievance_officer` (rule F2), `0082_115_privacy_requests`, `0083_115_privacy_request_messages`, `0084_115_erasure_record`, `0085_115_erasure_notice`.
- **Tests:** `requests/*.test.ts`, `requests/domain/*.test.ts`, `requests/subject-data/*.test.ts`, `submit.pg.test.ts`; E2E `115-privacy-requests.spec.ts`.

### public-forms

Shared guards for public forms (#113).

- **Tables** (`public-forms.ts`): `form_rate_limit` (counts per form, scope and keyed hash of the IP network or address; never the raw value), `human_check_redemption` (spent challenges). Both clean up after themselves.
- **Use case:** `issueHumanCheckChallenge`: anyone, signed in or out; platform actors refused.
- **Helpers:** `takeFormAllowance`, `formKeyedHash`, `publicSender`, the proof-of-work check (`proof-of-work-check.ts`, port `src/server/ports/human-check.ts`).
- **Callers:** contact and safeguarding submissions. **Open:** the proof-of-work difficulty is a default (HR-51).

### registration

Institution registrations, their students' enrolments, and confirming registrations once paid.

- **Tables** (`registration.ts`, shared with `participants` and `guardians`): `institution_registration` (one institution in one competition; Registration reference `{code}-I-` + 5), `participant_profile` (`owner_kind` `institution`, `self` or `guardian`), `registration` (one participant in one competition; `route` `institution` or `individual`; a confirmed one gets a Registration number `{code}-R-` + 6).
- **Use cases:** `registerInstitutionForCompetition`, `listCompetitionsForInstitution`, `enrolStudent`, `listEnrolledStudents`, `withdrawStudent`, `importStudents`, `describeStudentImport`. Not a use case: `confirmRegistrations()` (`confirm.ts`), called by payments inside its capture transaction.
- **States** (`domain/registration-status.ts`; causes `coordinator`, `participant`, `payment`, `guardian`, `cancellation`):

  | From                                                           | To (cause)                                                         |
  | -------------------------------------------------------------- | ------------------------------------------------------------------ |
  | (new, institution route)                                       | `enrolled` (coordinator)                                           |
  | (new, individual route)                                        | `pending_payment`, or `pending_guardian` for a minor (participant) |
  | `enrolled`                                                     | `withdrawn` (coordinator), `confirmed` (payment)                   |
  | `pending_payment`                                              | `confirmed` (payment)                                              |
  | `pending_guardian`                                             | `pending_payment` (guardian, participant), `withdrawn` (guardian)  |
  | `confirmed`                                                    | `refunded` (payment, once the refund's money is back)              |
  | `enrolled`, `pending_payment`, `pending_guardian`, `confirmed` | `cancelled` (cancellation)                                         |
  | `withdrawn`, `refunded`, `cancelled`                           | nothing                                                            |

- **Rules:** the **registration window** follows the competition's status, and the closing instant closes it even if a status job runs late. Enrolling or withdrawing needs an open window and a verified institution. The age group is the age in completed years on the cut-off date. A student is recognised again by name and date of birth, or roll number, through a keyed hash. **Student import:** every CSV row follows the single-enrolment rules; good rows are enrolled, bad rows come back as a report; nothing of the file is kept. Withdrawing keeps the row; enrolling again makes a new one. A minor's registration confirms only with the guardian's participation consent.
- **Who may call:** no `policy.ts`; every use case authorizes `institution.coordinate` for that institution.
- **Pages:** `/institution/competitions`, `/institution/registrations/[ref]` (list, enrol, withdraw), `.../students/new`, `.../import` (with `template.csv` and `sample.csv`). No staff page lists registrations.
- **Events:** `registration.institution_registered` → `registration.notify_principal`; `registration.confirmed` → `registration.send_confirmation`.
- **Missing:** an adult can't withdraw their own unpaid registration; principal and confirmation SMS wait for DLT (HR-14).
- **Tests:** `enrol-student.test.ts`, `enrol-student.pg.test.ts`, `import-students.test.ts`, `register-institution.test.ts`; E2E `75-*.spec.ts`, `76-import-students.spec.ts`.

### reminders

Named reminders before a deadline, sent to whoever still owes it when each one runs (#84 unit 84b). The first is `entry_submission_due`.

- **Registry** (`registry.ts`): each reminder is a `ReminderDefinition`: its name, its subject type (`competition`), the hour settings that time it, its message template, its deadline (`deadlineOf`), the subjects the sync visits, who owes it (`owes`, as groups of registrations and the roster roles to remind) and its template values. **Adding one** (#90 school-round shortlist, #93 dispatch, #125 events): a file in `definitions/`, one line in `REMINDERS`, its hour settings in the settings catalogue (group `reminders`, copy in `adminSettings.json`), and a custom migration with its template and two routes on `reminder.due` (like `0080_84_reminder_messages`). `registry.test.ts` fails until all four are there. A subject other than a competition (#125) also adds a subject type and an audience kind.
- **Table** `reminder_job` (`src/server/db/schema/reminders.ts`): one row per planned reminder: name, subject, offset, the deadline it was planned for, `fire_at`, `status` (`scheduled`, `fired`, `cancelled`, `superseded`; all in the first migration), `fired_at`. A partial unique index allows one live plan per reminder, subject, deadline and offset. No personal data; who was reminded is in `message_delivery`, keyed by the row's id.
- **Scheduling** (`schedule-reminders.ts`, `domain/schedule.ts`): `competition.published`, `.key_dates_changed` and `.cancelled` → `reminders.schedule`, plus the hourly `reminders.sync`. Rows that still match the deadline and the settings stay; the rest are superseded (cancelled with their competition); each new row is saved with a delayed `reminder.due` event at `fire_at`. An offset whose time has gone is skipped, not sent late.
- **Running** (`run-reminder.ts`): `reminder.due` → `reminders.run` locks the row and checks it against things as they are now: the deadline unchanged and ahead, the offset still in settings, no nearer reminder due too (after an outage only the nearest goes). Then it asks who owes the deadline, plans the roster through `announcements/delivery-plan.ts` and sends through `roster-delivery.ts`. A fired row's retry sends only what didn't go. Each firing is audited (`reminder.fired`, by the system).
- **`entry_submission_due`** (`definitions/entry-submission-due.ts`): `submissions_close`; offsets `reminders.entrySubmissionDueFirstHours` (72) and `...SecondHours` (24), 0 for none (HR-37). A confirmed registration owes it with no entry, or only a rejected or failed one (`processing` counts as made). Individuals: the adult, or a minor's guardians. Schools, under `all_participants` only: each coordinator, once per run. Template `reminders.entry_submission_due` (email, in-app, SMS once DLT-registered, HR-14; copy HR-36).
- **Use cases** (`index.ts`): `scheduleReminders`, `syncReminders` (`reminder.schedule`: the worker or the seed), `runReminder` (`reminder.run`: the worker). No person calls them; there is no page.
- **Migrations:** `0079_84_reminders`, `0080_84_reminder_messages`. **Seed:** `seed/reminders.ts` plans the seeded competitions' reminders.
- **Tests:** `reminders-*.test.ts`, `registry.test.ts`, `domain/*.test.ts`, `reminders.pg.test.ts`, `seed/reminders.test.ts`.

### safeguarding

The public "report a concern" form and the **safeguarding lead**'s queue.

- **Tables** (`safeguarding.ts`): `safeguarding_report` (words in encrypted columns), `safeguarding_incident_log` (`note`, `status_change`, `escalation`; append-only, `drizzle/0029_116_incident_log_append_only.sql`).
- **Use cases:** `submitSafeguardingReport`, `listSafeguardingReports`, `viewSafeguardingReport`, `moveSafeguardingReport`, `assignSafeguardingReport`, `addIncidentLogEntry`.
- **States** (`domain/report-status.ts`): `new` → `triaged` (sets severity `critical`/`high`/`medium`/`low`); `triaged` → `investigating` or `resolved`; `investigating` → `escalated` (with the authority's reference) or `resolved`; `escalated` → `resolved`; `resolved` final; later facts go in the incident log.
- **Rules:** works without an account; the answer reveals nothing about the report. Human check plus a per-IP limit (`safeguarding.reportsPerIpPerHour`, default 10). Reference `SG-{YY}-` + 6. Notes up to 4,000 characters. **Retention:** 7 years after resolution or until the child turns 25, whichever is later; open reports are kept while open.
- **Who may call:** anyone may submit. Everything else: `safeguarding_lead` only; super admin is not allowed.
- **Pages:** `/safeguarding/report`, `/safeguarding/report/sent` (with the quick-exit bar from `src/app/@exit/`); staff `/admin/safeguarding`, `/admin/safeguarding/[id]`.
- **Events:** `safeguarding.report_submitted`; leads get `safeguarding.report_alert`, which never includes the contents. **Open:** HR-48.
- **Tests:** `submit.test.ts`, `queue.test.ts`, `policy.test.ts`, `retention-policy.test.ts`; E2E `116-safeguarding-reports.spec.ts`.

### second-factor

Staff TOTP or passkey, step-up, staff session lifetimes. Overview: [Sign-in, sessions and the second factor](#sign-in-sessions-and-the-second-factor).

- **Tables** (`second-factor.ts`): `second_factor` (`totp` or `passkey`), `session_second_factor`, `second_factor_lockout`, `webauthn_challenge`.
- **Use cases:** `startTotpEnrolment`, `confirmTotpEnrolment`, `verifySecondFactor`, `mySecondFactors`, `staffAccess`, `removeSecondFactor`, `resetSecondFactors`, `startPasskeyRegistration`, `finishPasskeyRegistration`, `startPasskeyVerification`, `finishPasskeyVerification`.
- **Rules:** 5 failures in 15 minutes lock the user (not the session) for 15 minutes. A passkey challenge is answered once within 5 minutes. TOTP secrets are sealed by `secret-box.ts`. The staff session limit is enforced at session creation, at role grant and at actor resolution.
- **Who may call:** view, enrol, verify: signed in. Remove: `stepUp(signedIn)`. Reset: `stepUp(super_admin)`.
- **Pages:** `/account/security`, `/auth/second-factor`, `/auth/step-up`, the gate in `src/app/(staff)/layout.tsx`. **Missing:** no page calls `resetSecondFactors` yet (the super admin's recovery path).
- **Tests:** `totp.test.ts`, `passkey.test.ts`, `step-up.test.ts`, `staff-gate.test.ts`, `reset-revocation.pg.test.ts`; E2E `60-staff-two-factor.spec.ts`.

### settings

Runtime settings a super admin changes without a deploy.

- **Table:** `setting`. **Use cases:** `listSettings` (super admin), `changeSetting` (`stepUp(super_admin)`). `readSetting` and `databaseSettings` back the `settings` port.
- **Page:** `/admin/settings`.
- **Catalogue** (`catalogue.ts`):

  | Key                                                                          | Default                    | Note                                                  |
  | ---------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
  | `auth.staffSessionHours`                                                     | 12                         | 1 to 24                                               |
  | `auth.emailSignIn`                                                           | true                       | production also needs SES ready                       |
  | `sms.enabled`                                                                | false                      | waits for HR-14                                       |
  | `sms.maxPerHour`, `sms.maxPerDay`                                            | from `CODE_REQUEST_LIMITS` | sign-in text ceilings                                 |
  | `org.has80G`, `org.fcraEnabled`                                              | false                      | HR-16                                                 |
  | `org.legalName`, `org.registrationType`, `org.registrationNumber`, `org.pan` | empty                      | HR-21                                                 |
  | `safeguarding.reportsPerIpPerHour`                                           | 10                         | HR-48                                                 |
  | `breach.authorityEmail`                                                      | empty                      | HR-49                                                 |
  | `reminders.entrySubmissionDueFirstHours`, `...SecondHours`                   | 72, 24                     | hours before submissions close; 0 for none (HR-37)    |
  | `retention.enforce`                                                          | false                      | the sweep only counts until a super admin turns it on |
  | `retention.<policy>Days`                                                     | per policy                 | one per retention policy                              |
  | `privacy.requestDueDays`, `privacy.erasureDueDays`                           | 30                         | days to answer a rights request; HR-30                |
  | `privacy.exportLinkHours`                                                    | 72                         | a data export's link, then the export is deleted      |
  | `privacy.erasureEnabled`                                                     | false                      | carrying out erasures waits for HR-30                 |
  | `privacy.erasureKeepsPayerAccount`                                           | true                       | keep a payer's account under the financial floor      |

- **Tests:** `settings.test.ts`, `catalogue.test.ts`, `values.test.ts`; E2E `62-settings.spec.ts`.

### Worker jobs and schedules

- **Schedules** run from pg-boss in single-database mode only (`src/worker/schedules.ts`), in IST.
- **Outbox handlers** run when their event is drained, every `WORKER_POLL_SECONDS` (default 5). **Delayed** handlers wait for `availableAt`.
- Registry: `src/server/outbox/handlers.ts`; event-to-handler map: `SUBSCRIBERS` in `src/server/outbox/events.ts`.

| Job                                             | Kind                                    | Runs when                                             | Code                                                                  |
| ----------------------------------------------- | --------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `offsite_copy`                                  | schedule                                | 01:30 daily, 3 retries, 3 h expiry                    | `modules/offsite-copy/schedule.ts`                                    |
| `privacy.retention_sweep`                       | schedule                                | 02:15 daily                                           | `modules/privacy/schedule.ts`                                         |
| `privacy.flag_overdue`                          | schedule                                | 09:00 daily                                           | `modules/privacy/requests/overdue.ts`                                 |
| `privacy.build_export`, `privacy.expire_export` | outbox (expiry delayed)                 | `privacy_request.export_requested`, at link expiry    | `modules/privacy/requests/subject-data/export.ts`                     |
| `privacy.execute_erasure`                       | outbox                                  | `privacy_request.erasure_approved`                    | `modules/privacy/requests/subject-data/erasure.ts`                    |
| `ledger.reconcile_payments`                     | schedule                                | 03:00 daily                                           | `modules/ledger/backfill.ts`                                          |
| `reminders.sync`                                | schedule                                | 5 past every hour                                     | `modules/reminders/schedule.ts`                                       |
| `notifications.dispatch`                        | outbox                                  | most events                                           | `modules/notifications/dispatch.ts`                                   |
| `ledger.post_capture`, `ledger.post_refund`     | outbox                                  | `payment.batch_captured`, `refund.processed`          | `modules/ledger/consumers.ts`                                         |
| `refunds.send`                                  | outbox                                  | `refund.approved`                                     | `modules/payments/refunds/sync-refund.ts`                             |
| `files.scan_file`                               | outbox                                  | `files.file_uploaded`                                 | `modules/files/scan-handler.ts`                                       |
| `files.process_image`                           | outbox, media queue (worker-media only) | `files.processing_requested`                          | `modules/files/process-image.ts`, `src/worker-media/process-media.ts` |
| `entries.apply_file_outcome`                    | outbox                                  | every `files.*` outcome event                         | `modules/entries/apply-file-outcome.ts`                               |
| `entries.expire_upload_grant`                   | outbox, delayed                         | at grant expiry                                       | `modules/entries/upload-grants.ts`                                    |
| `entries.sweep_staged_upload`                   | outbox, delayed                         | shortly after expiry                                  | `src/server/outbox/handlers.ts`                                       |
| `cms.publish_scheduled_post`                    | outbox, delayed                         | at the publish instant                                | `modules/cms/posts/publishing.ts`                                     |
| `cms.publish_post_image`                        | outbox                                  | `files.file_processed`                                | `modules/cms/posts/images.ts`                                         |
| `competitions.advance_status`                   | outbox, delayed                         | at each key date                                      | `modules/competitions/advance-status.ts`                              |
| `competitions.retry_blocked_moves`              | outbox                                  | `rubric.published`, `competition.disciplines_changed` | `modules/competitions/advance-status.ts`                              |
| `registration.send_cancellation`                | outbox                                  | `registration.competition_cancelled`                  | `modules/competitions/cancellation-message.ts`                        |
| `announcements.fan_out`                         | outbox                                  | `competition.announcement_sent`                       | `modules/announcements/fan-out.ts`                                    |
| `reminders.schedule`                            | outbox                                  | a competition published, re-dated or cancelled        | `modules/reminders/schedule-reminders.ts`                             |
| `reminders.run`                                 | outbox, delayed                         | `reminder.due`, at each reminder's fire time          | `modules/reminders/run-reminder.ts`                                   |
| `breaches.fan_out`                              | outbox                                  | `breach.fan_out_requested`, one page per delivery     | `modules/breaches/fan-out.ts`                                         |
| `breaches.send_authority_notice`                | outbox                                  | `breach.authority_notice`                             | `modules/breaches/authority-message.ts`                               |
| `consent_links.deliver`                         | outbox                                  | `consent.link_sent`                                   | `modules/consent-links/delivery.ts`                                   |
| `institutions.send_coordinator_invitation`      | outbox                                  | `institution.coordinator_invited`                     | `modules/institutions/coordinators/invitation-message.ts`             |
| `contact.send_acknowledgement`                  | outbox                                  | `contact_message.received`                            | `modules/contact/acknowledge.ts`                                      |
| `registration.notify_principal`                 | outbox                                  | `registration.institution_registered`                 | `modules/registration/principal-message.ts`                           |
| `registration.send_confirmation`                | outbox                                  | `registration.confirmed`                              | `modules/registration/confirmation-message.ts`                        |
| `guardians.send_teen_invitation`                | outbox                                  | `guardian.teen_invited`                               | `modules/guardians/teen-invitation-message.ts`                        |
| `guardians.send_guardian_request`               | outbox                                  | `guardian.guardian_requested`                         | `modules/guardians/guardian-request-message.ts`                       |

Not a worker job: `pnpm files:purge-preview` (dormant preview cleanup, [Dormant preview machinery](#dormant-preview-machinery)). Missing jobs: a payment reconciliation sweep.

## Codebase map

```text
.
├── README.md                  this file
├── AGENTS.md, CLAUDE.md       agent instructions (Next 16 docs, issue tracker, labels, glossary rule)
├── GLOSSARY.md                domain dictionary: use these words in code, copy and PRs
├── docs/
│   ├── adr/                   decisions 0001-0009
│   └── privacy/               data-inventory.md
├── src/
│   ├── app/                   Next.js App Router: pages, layouts, Server Actions, route handlers
│   │   ├── (auth)/            sign-in and sign-up
│   │   ├── (staff)/admin/     staff screens behind the second-factor gate
│   │   ├── (legal)/           privacy, terms, safeguarding (report form), child protection
│   │   ├── @exit/             quick-exit bar (parallel route)
│   │   ├── account/ dashboard/ participant/ guardian/ institution/ institutions/   signed-in areas
│   │   ├── competitions/ blog/ about/ impact/ donate/ contact/ documents/ ...      public pages
│   │   ├── consent/[token]/ invitations/[token]/   bearer-link pages
│   │   ├── api/               health, files, webhooks/razorpay, csp-report, capture-mailbox, preview/drain, local-storage
│   │   └── monitoring/        same-origin Sentry tunnel
│   ├── server/                all domain logic
│   │   ├── app.ts deps.ts actor.ts use-cases.ts   composition root
│   │   ├── errors.ts ids.ts input.ts              DomainError, UUIDv7, invalid_input
│   │   ├── identity/ access/ audit/ outbox/ mailbox/ observability/ ports/ seed/ db/ crypto/ rich-text/
│   │   └── modules/           domain modules (see Domain modules)
│   ├── worker/                VPS worker: config, supervisor, relay ticks, pg-boss, heartbeat
│   ├── worker-media/          image derivative process (child process with a timeout)
│   ├── components/            React components (site shell, forms, competitions, payments, art, ...)
│   ├── lib/                   shared pure helpers: routes, CSP, security headers, SEO, analytics, observability
│   ├── i18n/                  next-intl config, formats, message loading
│   ├── content/               static copy: awareness, stories, legal drafts, competitions, sample data
│   ├── assets/                fonts, site photos, AI illustrations (ADR 0003)
│   ├── test/                  Seam 1 harness, PGlite helpers, fakes/
│   ├── proxy.ts, request-proxy.ts   request proxy (redirects, 404s, nonce CSP)
│   ├── env.ts, env.schema.ts  environment parsing and rules
│   └── instrumentation*.ts    env check at start-up, error reporting
├── messages/en-IN/            UI strings, one JSON file per area
├── drizzle/                   SQL migrations and meta/ (journal, snapshots)
├── scripts/                   migrate, seed, bootstrap-super-admin, offsite-restore, check-build, brand and art builds
├── tests/e2e/                 Playwright journeys (Seam 2) with axe; prod-smoke runs read-only against the live site
├── public/                    favicon and brand files (public/brand/README.md: the logo is a registered mark)
├── fixtures/media/            sample media for tests
├── docker/                    VPS stack: compose.yml, workers.yml, edge.yml, errors.yml, analytics.yml,
│                              caddy/, clamav/, crowdsec/, pgbouncer/, postgres/, systemd/, scripts/, README.md (runbook)
├── docker-compose.yml         local stack: Postgres, migrate, app
├── Dockerfile                 targets: build, migrate, worker, worker-media, runner
├── .github/                   actions/setup, workflows/ (ci.yml, deploy-production.yml, e2e.yml, uptime.yml)
├── next.config.ts             headers, CSP, Umami rewrites, next-intl plugin
├── vercel.json                region bom1, Git deployments off
└── vitest*.config.ts, playwright.config.ts, drizzle.config.ts, .oxlintrc.json, .oxfmtrc.json
```

Brand files: `pnpm brand:assets` regenerates the derived logo files from the SVG master; `pnpm art:build` builds the site illustrations. Never redraw or recolour the logo.

## Database and migrations

FOA keeps its data in PostgreSQL 18. Tables are defined in TypeScript with Drizzle ORM. `drizzle-kit` turns schema changes into numbered SQL files in `drizzle/`. The same SQL files build production, CI's database and every test database.

```text
drizzle.config.ts            drizzle-kit settings: schema barrel, output folder, DIRECT_URL
drizzle/
  NNNN_<issue>_<slug>.sql    one file per migration
  meta/_journal.json         the order and timestamp ("when") of every migration
  meta/NNNN_snapshot.json    drizzle-kit's picture of the whole schema after each migration
src/server/db/
  index.ts                   the app's `db` client
  app-db.ts                  `AppDb`: the type use cases accept (app client, test client or a transaction)
  database-url.ts            which database a deployment uses (preview naming in it is dormant)
  schema/index.ts            barrel: one `export * from "./<module>"` line per schema file
  schema/<module>.ts         one file per module
  types/encrypted-text.ts    the `encryptedText()` column type
scripts/migrate.ts           pnpm db:migrate
scripts/seed.ts              pnpm db:seed
src/test/db.ts               test databases: PGlite with the real migrations
```

Migrations `0000`-`0067` are applied in production. This session added `0068`-`0078`, in merge order: #264's `0068`-`0070`, #266's `0071_114_privacy_retention` and `0072_114_contact_retention_grants`, #262's `0073_80_pre_cancel_enum_values`, `0074_80_cancel_competition` and `0075_80_cancel_messages`, and #267's `0076_116_breach_log`, `0077_116_breach_timeline_append_only` and `0078_116_breach_notice_defaults`. Run `ls drizzle/*.sql | tail` for the current tail.

| Command                                           | What it does                                               |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm db:generate --name <issue>_<slug>`          | Writes a migration for your schema change                  |
| `pnpm db:generate --custom --name <issue>_<slug>` | Writes an empty migration for hand-written SQL             |
| `pnpm db:migrate`                                 | Applies pending migrations to the database in `DIRECT_URL` |
| `pnpm db:seed`                                    | Fills a local database with seed data                      |
| `pnpm db:studio`                                  | Opens drizzle-kit's table browser                          |

Every drizzle-kit command and script reads `DIRECT_URL` (from the environment or `.env`), never `DATABASE_URL`. Schema files must never import `server-only`, because drizzle-kit and the scripts load them under plain Node.

### The app's database client

`src/server/db/index.ts` builds one Drizzle client over postgres.js. It connects on first use, so `next build` needs no database.

| Setting           | Value   | Why                                                          |
| ----------------- | ------- | ------------------------------------------------------------ |
| `prepare`         | `false` | PgBouncer in transaction mode can't keep prepared statements |
| `max`             | 5       | each Vercel Function instance keeps a small pool             |
| `idle_timeout`    | 20 s    | idle instances free PgBouncer slots soon                     |
| `connect_timeout` | 5 s     | fail fast when PgBouncer is down                             |
| `query_timeout`   | 20 s    | backstop; the role's 15 s `statement_timeout` fires first    |

TLS comes from the URL's `sslmode` (`verify-full` on Vercel).

### Servers, databases and roles

```text
Vercel functions  -- DATABASE_URL, role foa_app ------.
Deploy workflow   -- DIRECT_URL,   role foa_migrator -+-> PgBouncer 1.26, db.friendsofanimals.dev:6432 (TLS, SCRAM)
                                                            database "foa"     -> pg-prod
                                                            any other database -> pg-nonprod
worker-prod       -- role foa_worker, straight to pg-prod:5432 (never PgBouncer: pg-boss needs real sessions)
```

pg-prod holds `foa` (production) and `umami` (analytics). pg-nonprod holds `foa_staging` (never migrated), the `foa_seed` template and leftover preview databases. Only pg-prod is backed up.

| Role (pg-prod)   | Used by                                  | Rights                                                                                                                                                  | PgBouncer mode | Limits                                       |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------- |
| `foa_migrator`   | `pnpm db:migrate` in the deploy workflow | owns `foa` and everything in it                                                                                                                         | session        | no statement limit; 30 s lock wait           |
| `foa_app`        | the app on Vercel                        | read and write rows, sequences, functions, through default privileges; can't create tables                                                              | transaction    | 15 s per statement, 60 s idle in transaction |
| `foa_worker`     | `worker-prod`                            | member of `foa_app`; owns schema `pgboss`; DELETE on `contact_message` and `safeguarding_report` for the retention sweep (`0072`), which `foa_app` lost | not used       | 60 s per statement, 10 s lock wait           |
| `pgbouncer_auth` | PgBouncer's password lookup              | runs `pgbouncer.get_auth()` only                                                                                                                        |                |                                              |

pg-nonprod has matching `staging_*` and `nonprod_*` roles that nothing uses. The full role table and `pg_hba` rules are in `docker/README.md`, "Routing and roles".

What this means for migration SQL:

- New tables in `public` get `foa_app`'s rights through default privileges. Don't grant on them.
- Don't name roles in migrations: CI and tests run as `foa` or PGlite's superuser, where `foa_app` doesn't exist. To take rights away (append-only tables), read the holders from the table's ACL, as `drizzle/0005_59_audit_append_only.sql` and `drizzle/0059_105_ledger_guards.sql` do. Exception: `drizzle/0072_114_contact_retention_grants.sql` revokes DELETE and TRUNCATE on `contact_message` and `safeguarding_report` from every role but the owner (so from `foa_app`) and grants DELETE to `foa_worker` (and `staging_worker`, `nonprod_worker`), looking the roles up by name and skipping any that don't exist; it also makes `contact_note` and `safeguarding_incident_log` append-only. `docker/postgres/bootstrap/workers-{prod,nonprod}.sql` carry the same grant. So `foa_app` cannot delete those rows and only the worker's retention sweep can.
- A migration that creates another schema needs `GRANT USAGE ON SCHEMA ... TO foa_app` (`docker/postgres/bootstrap/prod.sql`). None does yet.

### Adding a migration

1. Edit `src/server/db/schema/<module>.ts`. For a new file, add `export * from "./<module>";` to `schema/index.ts`.
2. Run `pnpm db:generate --name <issue>_<slug>`, for example `--name 85_entries`. It writes the SQL, a snapshot and a journal entry.
3. Read the SQL. Look for drops, renames, type changes and `NOT NULL` columns added to tables that have rows. Change the schema and regenerate rather than editing generated SQL.
4. For SQL Drizzle can't express (triggers, functions, revokes, rows such as message templates, new enum values), run `pnpm db:generate --custom --name <issue>_<slug>`. Write below the `-- Custom SQL migration file` line, with `--> statement-breakpoint` between statements.
5. A new extension must also be listed in `extensions` in `src/test/db.ts` (today only `pg_trgm`).
6. Classify every new column in the privacy inventory, or `domain/coverage.test.ts` fails ([`privacy`](#privacy)).
7. Run `pnpm db:migrate` locally, then `pnpm test`. Restart a running `pnpm test:watch`.
8. Commit the schema change, the SQL, the snapshot and `drizzle/meta/_journal.json` together.
9. Make each migration safe for the code that is already live: add first, remove in a later deploy ([How production migrates](#how-production-migrates)).

### Rule F2: a new enum value ships before anything uses it

Postgres refuses to use an enum value in the same transaction that added it ("unsafe use of new value"), unless the type itself was created in that transaction. Drizzle's migrator runs **all pending migrations in one transaction**; `scripts/migrate.ts` only wraps it in a lock. So:

- Put each new value in its own custom migration named `<issue>_pre_<what>`, holding only `ALTER TYPE ... ADD VALUE IF NOT EXISTS '...';` lines (examples: `0053_81_pre_enum_minor_reg`, `0056_82_pre_enum_consent`, `0061_83_pre_file_purpose_consent_form`, `0064_85_pre_entry_image_purpose`, `0068_84_pre_enum_message_delivery`, `0073_80_pre_cancel_enum_values`).
- Then run `pnpm db:generate` for the rest. The generated file repeats the `ADD VALUE` line: delete it. The snapshot keeps the value, so CI stays green.
- No DDL or data statement in the same deploy may use the new value: no default, `CHECK`, index condition or backfill.
- Better still, give a new enum all its values when you create it (ADR 0004).

**Nothing in CI enforces this.** CI's empty-database migration and PGlite create every enum in the same transaction, which Postgres allows. Only a database that already has the type, like production, fails.

The danger is per deploy, not per PR. On 2026-11-24 production had 14 migrations and the deploy of `375eb35d` had 54 pending. `0056_82_pre_enum_consent` added a value to `consent_subject_type` (a type production had since `0011`), and `0060_83_consent_links` used it in a `CHECK`. The run failed and rolled back. The fix was **two deploys**: `4d85f7b7` (up to `0059`), then `375eb35d`.

Before every deploy, list the values pending migrations add and use (a helper, not in the repo):

```sh
# n = migrations production has applied: the deploy log's "Applied migrations: N", or on the VPS
#   docker exec foa-pg-prod psql -U postgres -d foa -At -c 'select count(*) from drizzle.__drizzle_migrations'
n=68
pending=$(jq -r --argjson n "$n" '.entries[$n:][].tag | "drizzle/\(.).sql"' drizzle/meta/_journal.json)
[ -n "$pending" ] && for v in $(grep -ho "ADD VALUE[^']*'[^']*'" $pending | sed "s/.*'\(.*\)'/\1/" | sort -u); do
  grep -l "'$v'" $pending | xargs -r grep -L "ADD VALUE[^']*'$v'" | sed "s|^|$v: |"
done
```

Check each hit. It is safe only if the enum type is created in the same batch, or the match isn't enum use. Otherwise **split the deploy**: deploy a `main` commit that has the `ADD VALUE` but not its first use (`gh workflow run deploy-production.yml -f ref=<sha>`), then deploy `main`. **The next production deploy** applies `0068`-`0078` in one transaction. Two of them add enum values: `0068_84_pre_enum_message_delivery` (`message_delivery_status` gains `sending`) and `0073_80_pre_cancel_enum_values` (`competition_status` and `registration_status` gain `cancelled`). No other migration in `0068`-`0078` names `sending` or `cancelled` (the helper with `n=68` prints nothing), and only app code uses them, after the run commits. So one deploy of `main` is safe; no split is needed. Run the check again if anything lands after `0078`.

### Never edit an applied migration

The migrator records a hash of each file but never compares it. It applies a journal entry only when its `when` is newer than the newest applied. So:

- An edited migration never runs again in production, while CI and tests get the new SQL. The schemas drift silently. Write a new migration instead.
- Treat everything on `main` as applied: production deploys only `main`.
- An entry whose `when` is older than production's newest is skipped without a word. CI's journal check and the deploy's count check catch that.

### When another branch landed migrations first

If two branches both add `0079_...`, `main`'s numbers win and your branch renumbers by **regenerating, never by renaming**:

1. Save your custom migrations: `mkdir -p /tmp/mine && cp drizzle/NNNN_<issue>_*.sql /tmp/mine/`.
2. Merge main and take its migrations folder whole: `git fetch foa && git merge foa/main`, then `git restore -s foa/main -SW -- drizzle`. Your schema changes in `src/server/db/schema/` stay.
3. Regenerate after main's last migration, in order: each `pre_enum` file (`pnpm db:generate --custom --name <same name>`, paste the saved body), then `pnpm db:generate --name <issue>_<slug>` (delete any repeated `ADD VALUE`), then your other custom files in their old order.
4. Check: `diff` each pasted file against `/tmp/mine`, run `pnpm exec drizzle-kit check`, run `pnpm db:generate` (it must print "No schema changes"), then `pnpm test`.

`git show e3ff6a25 --stat` is a finished example: it kept main's `0058`/`0059` ledger files and moved the Entries files from `0058`-`0060` to `0060`-`0062` with unchanged bodies and new snapshots. #262, #267 and #266 were renumbered the same way this session.

### What CI checks on migrations

The "Migrations" job runs on every PR against a `postgres:18.7-trixie` service:

| Step                              | Fails when                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Journal is in order               | `idx` isn't 0, 1, 2, ... or a `when` isn't larger than the one before          |
| `drizzle-kit check`               | snapshots disagree, such as two with the same parent after a bad merge         |
| Migrate an empty database         | any migration fails on a fresh database                                        |
| Schema has no ungenerated changes | `drizzle-kit generate` writes anything: the schema changed without a migration |

None of these sees production's state, so none catches an F2 break or an edited migration.

### How production migrates

The deploy workflow's build runs `pnpm db:migrate` against production before the new code is promoted ([Production deploys](#production-deploys)):

1. `pnpm db:migrate` takes a Postgres advisory lock, so two runs can't apply the same migration, then applies everything pending in **one transaction**: one failure and nothing is applied.
2. `pnpm db:seed` prints `Not seeding. APP_ENV=production: seed data goes only into preview and local databases.` and exits without connecting.
3. "Every migration is applied" fails unless `drizzle.__drizzle_migrations` has as many rows as the journal.

The old deployment serves traffic on the new schema for a few minutes, and keeps doing so if the smoke test fails. The worker never migrates; it is rebuilt separately.

### Seed data

`pnpm db:seed` (`scripts/seed.ts`) fills a database with realistic fake records. It is idempotent.

| `APP_ENV`               | What happens                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local` or unset        | Seeds only a database on `localhost`, `127.0.0.1`, `[::1]` or the Compose `db` host, and refuses deployed role and database names (`postgres`, `foa_app`, `foa_migrator`, `staging_*`, `nonprod_*`, `foa_staging`, `foa_seed`, `foa_pr*`, `foa_br*`) even through a tunnel |
| `preview`               | Seeds the preview's own database (dormant)                                                                                                                                                                                                                                 |
| `staging`, `production` | Exits 0 without connecting                                                                                                                                                                                                                                                 |

The seeders run in the order in `src/server/seed/index.ts`: accounts first ([Signing in locally](#signing-in-locally)), then roles, competitions, judging, consent, files, settings, safeguarding, institutions, registrations, payments, refunds, guardians and children, the ledger, notifications, contact, the CMS, posts, and the repo's five stories as posts. Tests use the same **seed builders**.

Production gets no seed data. Custom migrations insert message templates, routes and the chart of accounts. The first super admin comes from the bootstrap command. "Sample content" is placeholder material in code, shown wherever `APP_ENV` isn't `production` (`isSampleContentEnabled()` in `src/lib/site.ts`).

### Encrypted columns and the data inventory

Personal data that identifies someone directly is stored encrypted (ADR 0006).

- `encryptedText("<field>_ciphertext")` (`src/server/db/types/encrypted-text.ts`) is a plain `text` column whose TypeScript type, `Ciphertext`, can only come from `cipher.encrypt()`.
- Each write comes out different, so `eq(column, value)` never matches. To look a value up, store a blind index beside it: a `<field>_hash` column (example: `user.phone_hash`, unique).
- Every personal-data column must be in the privacy inventory with a purpose, a retention period and an expiry action ([`privacy`](#privacy)). `inventory.test.ts` fails if an encrypted column is missing; `domain/coverage.test.ts` fails if any column is unclassified.

### Backups and restore

Summary only. The runbook is `docker/README.md`: "Backups (pgBackRest) and restore", "Restore drill", "Real restore of production (outline)", "Off-site copy of files (Backblaze B2)", "Restore one file".

| What                   | How                                                                                                                                                                               | State on 2026-11-24                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| pg-prod database       | pgBackRest stanza `foa`, repo1 on a local volume, encrypted, 30 days. Full on Sundays, differential Mon-Sat, 02:30 IST. WAL archived continuously, so point-in-time restore works | Working                                                           |
| Off-site database copy | pgBackRest repo2 (HR-25; no open issue)                                                                                                                                           | **Not set up**. Losing the VPS loses the database and its backups |
| pg-nonprod             | none                                                                                                                                                                              | Not backed up, by design                                          |
| Restore drill          | `docker/scripts/restore-drill.sh` restores the newest backup into a throwaway container and compares tables with the newest snapshot; `foa-restore-drill.timer` runs it monthly   | One pass, 2026-11-21                                              |
| Uploaded files (R2)    | the `offsite_copy` schedule to B2; `pnpm offsite:restore` for one file                                                                                                            | **Not configured**                                                |

```sh
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa info   # list the backups
cd /srv/foa/docker && scripts/restore-drill.sh                      # run a drill now
```

Keep an offline copy of `/etc/foa/secrets/pgbackrest_repo1_cipher_pass`. Without it no backup can be restored.

## Local setup

A local run needs no provider accounts. Outside production, email and SMS go to the **capture mailbox**, payments use the **test checkout**, and uploads stay on your disk. The database is the only thing you run yourself.

### Prerequisites

| Tool       | Version | Notes                                                                                                                            |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 26.x    | `engines.node`. CI, the Dockerfile and the worker image use Node 26.                                                             |
| pnpm       | 12.21.0 | Pinned in `packageManager`. **Node 26 ships without corepack**: `npm install --global pnpm@12.21.0`.                             |
| PostgreSQL | 18      | Easiest through Docker (`postgres:18.7-trixie`, the same image as CI). A local Postgres needs the `pg_trgm` extension (contrib). |

### First run

```sh
pnpm install
docker compose up -d db          # Postgres 18 on 127.0.0.1:5432, login foa/foa, database foa
cp .env.example .env             # the defaults point at that database
pnpm db:migrate
pnpm db:seed                     # seed accounts and data (local only)
pnpm dev                         # http://localhost:3000
```

Next.js reads `.env` and `.env.local`. The scripts (`db:*`, `admin:*`, the worker, drizzle-kit) load them through `scripts/load-env.ts`. Shell variables win, then `.env.local`, then `.env`. Without Docker, create a role and database matching `.env.example` (`foa`/`foa`, database `foa`).

The root `docker-compose.yml` has three services: `db` (Postgres 18.7, volume `pgdata18`, `127.0.0.1:5432`), `migrate` (runs `pnpm db:migrate` once) and `app` (the production build with `APP_ENV=local` on `127.0.0.1:3000`). `docker compose up -d --build --wait` runs all three, but does not seed or set `CAPTURE_MAILBOX_TOKEN`. Day to day, start only `db` and use `pnpm dev`.

### Signing in locally

There is no password. You sign in with a one-time **sign-in code**. Outside production the code is written straight to the `captured_message` table. Read it either way:

```sh
# 1. Through the app: put CAPTURE_MAILBOX_TOKEN=$(openssl rand -hex 32) in .env.local and restart pnpm dev.
curl -s http://localhost:3000/api/capture-mailbox \
  -H "x-capture-mailbox-token: $CAPTURE_MAILBOX_TOKEN" -H "x-capture-mailbox-to: $ADDRESS"
# 2. Straight from the database:
docker compose exec db psql -U foa -d foa -c \
  "select to_address, body_text, created_at from captured_message order by created_at desc limit 5"
```

The API returns the last 5 messages to that address or phone, answers 404 without a token, and is always 404 in production.

**Seed accounts** (`src/server/seed/accounts.ts`), all on the `example.test` domain, all signing in by email code:

| Local part    | Who                                                       |
| ------------- | --------------------------------------------------------- |
| `super-admin` | Global super admin                                        |
| `member1`     | Member with several roles; also has a phone for SMS codes |
| `member2`     | Staff admin                                               |
| `member3`     | No roles                                                  |

Staff need a second factor before any staff page. Every seeded staff account already has an authenticator whose secret is the public constant in `src/server/seed/second-factor.ts`; add it to any authenticator app.

### Making the first super admin

```sh
pnpm admin:bootstrap-super-admin --email <address> [--name "<name>"] [--target <host>/<database>]
```

- It connects through `DIRECT_URL` and prints the target first.
- It creates a verified account if the address has none, then grants the global super admin role, through the audit log.
- It refuses once any global super admin exists, so on a seeded database it always refuses.
- `--target` must name the same `<host>/<database>` as `DIRECT_URL`; without it the script works only on a local database. The production run is in [Go-live](#go-live).
- The new admin enrols a second factor at first staff sign-in. Later roles are granted at `/admin/roles`.

### Background work locally

| Way                  | Command                                                                                                     | Notes                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local worker         | `pnpm worker:dev`                                                                                           | `src/worker/main.ts` in watch mode, `APP_ENV=local`, database from `DIRECT_URL`; creates the `pgboss` schema itself. Scans only if `CLAMD_HOST` is set; otherwise every scan fails and retries. |
| Drain once over HTTP | `curl -X POST http://localhost:3000/api/preview/drain -H "x-capture-mailbox-token: $CAPTURE_MAILBOX_TOKEN"` | Runs every due delivery in the app's process and returns. Needs the token; local and preview only; default queue only (no derivatives).                                                         |

- **Uploads without R2:** with `APP_ENV=local` and no `R2_*`, files go to `<system temp>/foa-local-storage`, served through signed URLs on `/api/local-storage/...` (404 on every deployment).
- **Scanning without ClamAV:** with the disk store and no `CLAMD_HOST`, the app uses a stand-in scanner (`src/server/ports/malware-scanner-local.ts`) that flags only EICAR. Files become clean after a drain through `/api/preview/drain`. The worker never uses the stand-in.
- **Payments without Razorpay:** the fallback gateway's test checkout is a dialog on the pay page where you choose pay or decline. No money moves; refunds complete at once.

### What works locally and what needs real keys

| Capability             | Locally (no keys)                                                  | Real service, where configured                                                                   |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Email                  | Capture mailbox                                                    | Amazon SES, production only (`SES_*`); email sign-in also needs `SES_PRODUCTION_ACCESS=true`     |
| SMS                    | Capture mailbox                                                    | MSG91, production only (`MSG91_*`); needs DLT templates                                          |
| Payments               | Test checkout                                                      | Razorpay; `rzp_test_` outside production, `rzp_live_` only in production                         |
| File storage           | Disk store                                                         | Cloudflare R2 (`R2_*`); public post images need `<R2_BUCKET>-public` and `PUBLIC_ASSET_BASE_URL` |
| Malware scan           | EICAR-only stand-in (app drain only)                               | clamd (`CLAMD_HOST`), the `foa-clamav` sidecar on the VPS                                        |
| PDFs (Gotenberg)       | Nothing                                                            | Runs on the VPS; no code calls it yet                                                            |
| Image derivatives      | Not produced                                                       | worker-media on the VPS; needs R2 and refuses to start without it                                |
| Passkeys               | Work on `http://localhost` (the relying party is `APP_URL`'s host) | Same code on the site's domain                                                                   |
| Error tracking         | Off                                                                | GlitchTip through the Sentry SDK                                                                 |
| Analytics              | Off                                                                | Umami, staging and production builds only                                                        |
| Off-site copy of files | Off                                                                | worker-prod, production only                                                                     |

The full check is in [Testing and CI](#testing-and-ci).

## Testing and CI

Four test layers plus a read-only smoke check of the live site. Only Vitest runs with nothing but Node 26 and `pnpm install`.

| Layer                          | Files                                                                                           | Command                              | Needs                                 | When CI runs it     |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- | ------------------- |
| Vitest (Seam 1 and unit tests) | `*.test.ts(x)` beside the code in `src/`, `scripts/`, `docker/`, `tests/e2e/` (about 600 files) | `pnpm test`                          | Nothing: in-process Postgres (PGlite) | Every run, 8 shards |
| Real-Postgres races            | `src/**/*.pg.test.ts`                                                                           | `pnpm test:pg`                       | A migrated throwaway Postgres         | Full runs only      |
| Live provider contracts        | `src/**/*.live.test.ts` (2 files)                                                               | `pnpm test:live`                     | Real R2 or B2 credentials             | Never; by hand      |
| Playwright journeys (Seam 2)   | `tests/e2e/*.spec.ts` (about 50)                                                                | `pnpm test:e2e`                      | A running app, its Postgres, Chromium | Full runs only      |
| Production smoke               | `tests/e2e/prod-smoke.spec.ts`                                                                  | `pnpm test:e2e --project=prod-smoke` | The live site                         | By hand (`e2e.yml`) |

Before you push:

```sh
pnpm check                      # typecheck + lint (oxlint) + format:check (oxfmt) + Vitest
pnpm build && pnpm check:build  # if you changed pages, config or client code; needs no database or secrets
```

### Vitest on PGlite

PGlite is Postgres compiled to WebAssembly, running inside the test process. `vitest.config.ts`:

- Runs `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.ts`, `docker/**/*.test.ts`, `tests/e2e/**/*.test.ts`; skips `*.pg.test.ts` and `*.live.test.ts`.
- Maps `@/` to `src/` and swaps `server-only` for an empty module.
- `src/test/global-setup.ts` applies the real migrations once per `vitest run` to one PGlite database and saves it as a template. `createTestDb()` (`src/test/db.ts`) loads a fresh copy per caller in about 0.3 s, so every test gets its own database without paying for migrations.
- In watch mode the template is built at start: restart Vitest after you change a migration.
- A test that must run something before migrations uses `createMigratedClient({ before })` (slower).

```sh
pnpm test                                                   # everything, once
pnpm test src/server/modules/payments/pay-again.test.ts     # one file
pnpm test -t "<part of a test name>"                        # matching tests
pnpm exec vitest run --shard=3/8                            # one CI shard
```

### Seam 1: use-case tests through the harness

Almost every test is a **Seam 1** test. It calls a use case the way a Server Action or route handler does, `as(actor).<useCase>(input)`, through `createHarness()` in `src/test/harness.ts`: a fresh PGlite with the real migrations, a fake clock, and in-memory fakes for every outside provider. **Never mock an internal module**: CI rejects `vi.mock("@/...")`.

```ts
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";

describe("someUseCase", () => {
  it("does what the actor expects", async () => {
    const h = await createHarness();
    const member = await h.seed.member();

    const result = await h.as(h.visitor()).someUseCase({ email: member.email });

    expect(result).toEqual({ ok: true });
    expect(h.email.lastTo(member.email)?.subject).toBe(
      "Your Friends of Animals sign-in code"
    );
  });
});
```

| Field                                          | What it is                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `h.as(actor)`                                  | Every use case, acting as `actor` (`createApp(deps)`)                                                                                                                                                                                                        |
| `h.visitor(meta?)`                             | A signed-out actor from IP `203.0.113.10`; pass `{ ip }` to vary it                                                                                                                                                                                          |
| `h.signIn(user)`                               | Signs in through the real email-code flow from a fresh IP and returns the actor. Staff also pass their second factor; `signIn(user, meta, { secondFactor: false })` stops after the code                                                                     |
| `h.passSecondFactor(actor)`, `h.totpCode(at?)` | Passes the second factor with the seed authenticator / that authenticator's code                                                                                                                                                                             |
| `h.currentActor(meta?, cookie?)`               | Who the server sees on the browser's next request, from `h.cookies`                                                                                                                                                                                          |
| `h.cookies`                                    | The browser's cookie store; `header()` saves one browser                                                                                                                                                                                                     |
| `h.seed`                                       | Seed builders on this database and clock: `member()`, `pendingEmailAccount()`, `superAdmin()`, `grant()`, `authenticator()`, `competition()`, `institutionRegistration()`, `guardian({ children })`, `preview()` (all seed data)                             |
| `h.clock`                                      | `FakeClock`: `now()`, `advance({ minutes: 10 })`, `set(instant)`. Starts at 2027-01-15 04:30 UTC unless `createHarness({ now })`                                                                                                                             |
| `h.email`, `h.sms`                             | `sent`, `lastTo(to)`, `codeFor(to)`, `failNext(n, error)`                                                                                                                                                                                                    |
| `h.settings`                                   | Settings over this database; every setting starts at its default. `await h.settings.set("sms.enabled", true)`. To test production holding email sign-in off: `createApp({ ...h.deps, settings: settingsFor(h.deps.settings, { emailSignInReady: false }) })` |
| `h.errors`                                     | `reported`, each scrubbed as Sentry would get it                                                                                                                                                                                                             |
| `h.drain()`                                    | Delivers every due outbox event in process with the real relay, on every queue, until nothing is due                                                                                                                                                         |
| `h.storage`                                    | `put(url, bytes, headers)` and `get(url)` on presigned URLs, as a browser; `plant()` puts an object directly                                                                                                                                                 |
| `h.scanner`                                    | Flags only EICAR (`src/test/eicar.ts`); `scans`, `failNext(n)`                                                                                                                                                                                               |
| `h.media`                                      | Sizes derivatives from image headers; `processed`, `failNext(n, code)`                                                                                                                                                                                       |
| `h.gateway`                                    | `orders`, `capture(orderId)`, `fail(orderId)`, `refuseNextOrder()`, `webhook(event, { signature })` (signed, badly signed, unsigned, replayed), refund helpers (`refunds`, `settleRefund`, `answerNextRefund`, `addDashboardRefund`, `failNextFetch`)        |
| `h.db`                                         | This test's database; assert on rows (audit rows count as behaviour)                                                                                                                                                                                         |
| `h.deps`                                       | The full `Deps`, with fakes and fresh keys. `createHarness({ appEnv })` changes `appEnv` (default `local`)                                                                                                                                                   |

`createHarness()` fakes `Date` (Better Auth reads `new Date()`), and the database closes when the test ends. So call it inside a test or `beforeEach`, never `beforeAll`.

**Rules for code and tests:**

- Use cases read time only from `ctx.clock` and make ids with `uuidv7(ctx.clock.now())`. Never `new Date()`, `Date.now()` or `process.env` in a use case.
- Assert on what the actor sees: return values, what another use case can then read, what the fakes received, and the rows a compliance rule cares about.
- Every new use case needs an allowed-role test and a refused-role test. A staff use case needs a staff actor who passed the second factor (`h.signIn` does it); a step-up action needs it passed again after `h.clock.advance`.
- A new module adds one set to `composeUseCases(...)` in `src/server/app.ts`.
- A new provider port gets a port file in `src/server/ports/`, a production adapter, a fake in `src/test/fakes/`, and a shared `<port>.contract.ts` both pass. Add it to `Deps`, `productionDeps()`, `createHarness()` and `createPgWorld()` in `src/test/pg.ts`.
- A module with seed data adds one seeder to `seeders` in `src/server/seed/index.ts`, after those it depends on. Seeders must be safe to run again.

**Events.** A use case that triggers work elsewhere calls `emit(tx, ctx.clock, event)` in the same transaction as its change. A test then drains and checks what the handler did. Retries follow the fake clock: `h.email.failNext(1)`, drain, `h.clock.advance({ seconds: 30 })`, drain again. `listFailedDeliveries(h.db)` lists failures.

**Files.** `requestUpload` presigns, the test PUTs with `h.storage.put(uploadUrl, bytes, headers)`, then `completeUpload` checks it. `put` and `get` check signature, method, headers and expiry against `h.clock`, so `h.clock.advance({ seconds: 301 })` makes a download URL fail with `expired`. To skip the scan, set the file row's `status` to `clean` directly.

**Module helpers.** Many modules have a `testing.ts` that builds a ready world through the real use cases, for example `schoolWithStudents(h, { students: 2 })` in `src/server/modules/payments/testing.ts`. App code never imports them. Other helpers in `src/test/`: `render.ts` (Server Component tests), `next-intl-server.ts` and `next-image.ts` (package stand-ins, allowed in `vi.mock`), `human-check.ts`, `media-fixtures.ts`, `webp.ts`, `xss-corpus.ts`.

### Real Postgres: `pnpm test:pg`

PGlite has one connection, so it can't show two requests racing. `*.pg.test.ts` files use `createPgWorld()` from `src/test/pg.ts`: the same use cases and fakes over a real Postgres pool, a second client (`world.sql`) to hold locks, and `world.waitForLockWaiters(n)`. One file runs at a time. It reads `DIRECT_URL` (or `DATABASE_URL`) from the environment, not `.env`, and the URL must pass the local-seed guard. Tests leave rows behind, so use a throwaway database:

```sh
docker compose up -d db
docker compose exec db createdb -U foa foa_pg
export DIRECT_URL=postgres://foa:foa@localhost:5432/foa_pg
pnpm db:migrate && pnpm test:pg
```

### Live contracts: `pnpm test:live`

Each `*.live.test.ts` runs a port contract against a real service in a folder it deletes at the end. Non-production buckets only. The variables each needs are in the file headers: `src/server/ports/storage-r2.live.test.ts` (`R2_*`) and `src/server/ports/copy-bucket-s3.live.test.ts` (`OFFSITE_CONTRACT=1` and `OFFSITE_CONTRACT_*`).

### Playwright journeys (Seam 2)

Playwright never starts a server. It tests whatever `PLAYWRIGHT_BASE_URL` points at and refuses to load without it.

- Projects: `desktop` and `mobile` (Pixel 7) run every spec except `prod-smoke.spec.ts`; `prod-smoke` runs only that file. All Chromium.
- `retries: 0`: a check that fails only sometimes is still a failure. Traces and screenshots are kept on failure in `test-results/` (`pnpm exec playwright show-trace <path>/trace.zip`).
- Accessibility: `tests/e2e/support/a11y.ts` gives `expectAccessible(page, label)` (a `<main>`, one `h1`, a title, zero axe violations), `expectRendersAccessibly` and `expectAccessibleInDark`. Specs call these on every page they visit.
- `tests/e2e/support/mailbox.ts` reads the capture mailbox (`readCode`, `readEmail`, `freshEmail`, `freshPhone`) and `drainOutbox()` calls `POST /api/preview/drain`, because CI runs no worker. Both need `CAPTURE_MAILBOX_TOKEN`.
- `seed-*.ts` fixtures write straight into the app's database. They refuse unless the base URL is loopback and `APP_ENV=local`, and they need the same `BETTER_AUTH_SECRET` and field keys as the server (or none on both).
- Name new specs `tests/e2e/<issue>-<slug>.spec.ts`.

**How CI runs them.** Each E2E job starts Postgres 18, generates random `CAPTURE_MAILBOX_TOKEN`, `BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS` and `FIELD_HMAC_KEY`, runs `pnpm db:migrate && pnpm db:seed && pnpm build && pnpm check:build`, then starts two servers from one build: `pnpm start` on `:3000` with `APP_ENV=local`, and `APP_ENV=staging` on `127.0.0.1:3101`. The staging one serves `55-guardian-launch-pause.spec.ts` (via `PLAYWRIGHT_GUARDIAN_PAUSED_URL`), which checks the "coming soon" screens of the paused guardian flows. Then `pnpm test:e2e --project=<desktop|mobile> --shard=<n>/3`.

### Run one journey locally

```sh
docker compose up -d db
cp .env.example .env
pnpm install
export CAPTURE_MAILBOX_TOKEN="$(openssl rand -hex 32)"   # the server and Playwright share it
pnpm db:migrate && pnpm db:seed && pnpm build
pnpm start &                                             # http://localhost:3000
pnpm exec playwright install --with-deps chromium        # once
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e --project=desktop tests/e2e/57-email-otp.spec.ts
```

Add `--ui` to watch it. To mirror CI fully, export `BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS` and `FIELD_HMAC_KEY` (generated as in `ci.yml`) **before** `pnpm db:seed`, then start the second server:

```sh
export PLAYWRIGHT_GUARDIAN_PAUSED_URL=http://127.0.0.1:3101
APP_ENV=staging APP_URL=$PLAYWRIGHT_GUARDIAN_PAUSED_URL pnpm start --hostname 127.0.0.1 --port 3101 &
```

### Test integrity rules

The CI job "Test integrity" fails if any test file (`tests/`, `src/test/`, `*.test.ts(x)`, `*.spec.ts`) contains:

- `.skip(`, `.only(`, `.todo(`, `fixme`, `test.fail(`, `retry:`, `retries:`, or axe weakening (`disableRules`, `.exclude(`, `withTags`);
- `vi.mock("@/...")` (mocking an app module);
- a non-zero `retries` in `playwright.config.ts` or `retry` in `vitest*.config.ts`;
- and `vercel.json` must keep `"git": { "deploymentEnabled": false }`.

### The CI workflow

`.github/workflows/ci.yml` runs on every PR event (opened, pushed, reopened, labelled), every push to `main`, and by hand. A new push cancels that PR's older run.

| Job                              | What it does                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Choose the jobs to run (`scope`) | `full` is true for non-PR runs, PR branches starting `revert/`, and PRs labelled `full-ci`                                                     |
| Lint, Typecheck, Format check    | `pnpm lint`, `pnpm typecheck`, `pnpm format:check`                                                                                             |
| Vitest (shard n/8)               | 8 parallel jobs                                                                                                                                |
| Test integrity                   | The rules above                                                                                                                                |
| Build without a database         | `pnpm build && pnpm check:build` with empty database URLs: pages must prerender without a database; bundle-size, browser-syntax and CSP checks |
| Migrations                       | [What CI checks on migrations](#what-ci-checks-on-migrations)                                                                                  |
| E2E desktop/mobile (shard n/3)   | 6 jobs, only when `full`                                                                                                                       |
| Real-Postgres concurrency        | `pnpm db:migrate && pnpm test:pg`, only when `full`                                                                                            |
| **CI gate**                      | The one required check. Passes only if every job succeeded, or E2E and Postgres were skipped on a non-`full` PR                                |

**Add the `full-ci` label before merging** (`gh pr edit <pr> --add-label full-ci`). A full run is 23 jobs and takes about 5 minutes (up to 8.5); E2E shards are the slowest at 3 to 5 minutes.

**Ruleset on `main`** (nobody may bypass): changes arrive only by PR (no approval needed); "CI gate" must pass on a branch that is **up to date** with `main`; merge commits only (squash and rebase are off); no force pushes or deletion. The head branch is deleted on merge; auto-merge and "Update branch" are on. There is no merge queue. The ruleset's pull-request rule also sets `require_extra_approval_for_unattributed_changes: true`.

**Three merges this session hit an E2E job failure on `main`** (#282, #268 and #264): twice "Installing Chromium failed (exit status: none after 5 minutes)", a runner timeout in E2E mobile, and once a flaky `tests/e2e/70-competitions-admin.spec.ts` in E2E desktop. None was a code failure, and CI was green again from #277. Several PR runs needed a second attempt. Fix such a run with `gh run rerun <id> --failed`.

### Other workflows

- **`e2e.yml` "Production smoke"**, manual: `gh workflow run e2e.yml -f url=https://friendsofanimals.dev`. Read-only: every public page answers 200 and passes axe in light and dark, `/api/health`, `robots.txt` and `sitemap.xml`, no `noindex`, a CSP header, the 404 page, `www` → apex with 308, no analytics cookie. The deploy workflow does not run it.
- **`uptime.yml`**, scheduled every 5 minutes: `/api/health`, TCP `db.friendsofanimals.dev:6432`, `/api/health/worker`. GitHub runs it far less often (5 runs from 22 to 24 November). Don't rely on it as the only alarm.

## Deploy and infrastructure

**Vercel** serves the Next.js app. A **VPS** (Hostinger, Mumbai, Fedora 44) holds everything with state, run from a git clone at `/srv/foa` with the files in `docker/`. The runbook is [`docker/README.md`](docker/README.md).

```mermaid
flowchart LR
  user["Browser"] --> app
  subgraph gh["GitHub Actions"]
    deploy["Deploy production (by hand)"]
    uptime["Uptime (cron)"]
  end
  subgraph vercel["Vercel, region bom1"]
    app["Next.js app<br/>friendsofanimals.dev"]
  end
  subgraph vps["VPS, /srv/foa"]
    pgb["PgBouncer :6432 (TLS)"]
    pgp[("pg-prod: foa, umami")]
    pgn[("pg-nonprod: foa_staging, foa_seed")]
    worker["worker-prod"]
    side["ClamAV, Gotenberg"]
    caddy["Caddy :80/:443"]
    umami["Umami (stats.)"]
    gt["GlitchTip + own Postgres (errors.)"]
  end
  deploy -- "prebuilt upload, promote" --> app
  deploy -- "migrations (PROD_DIRECT_URL)" --> pgb
  app -- "DATABASE_URL" --> pgb
  pgb --> pgp
  pgb --> pgn
  worker -- "direct, not via PgBouncer" --> pgp
  worker --> side
  worker -- "errors" --> gt
  caddy --> umami --> pgp
  caddy --> gt
  uptime -. "probes" .-> app
  uptime -. "TCP probe" .-> pgb
```

### Production deploys

`vercel.json` pins functions to `bom1` and turns off Git deployments. Vercel never builds a push or a PR, and there are no previews. The only way to production is `.github/workflows/deploy-production.yml`, run by hand (ADR 0001). The Vercel project lives in the ACME team (moved there on 2026-11-24).

```sh
gh workflow run "Deploy production" --ref main          # the tip of main
gh workflow run deploy-production.yml -f ref=<sha>      # an older commit main contains (split deploys)
gh run watch
```

Only one deploy runs at a time. Run the [F2 check](#rule-f2-a-new-enum-value-ships-before-anything-uses-it) first, and confirm "CI gate" is green on the commit (`gh run list --workflow ci.yml --branch main`): the deploy workflow does not check CI and deploys any commit on `main`.

| #   | Step                                            | What happens                                                                                                                             | If it fails                                                                                 |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | The commit is on main                           | Refuses any commit `main` doesn't contain                                                                                                | Nothing changed                                                                             |
| 2   | Setup, Vercel CLI                               | Node, pnpm, `vercel@66.6.0`                                                                                                              | Nothing changed                                                                             |
| 3   | `vercel pull --environment=production`          | Downloads the non-secret production variables (`APP_ENV`, `APP_URL`, `NEXT_PUBLIC_*`) that the build bakes in                            | Nothing changed                                                                             |
| 4   | `vercel build --prod`                           | Runs `vercel-build`: `pnpm db:migrate` (production, through `PROD_DIRECT_URL`), `pnpm db:seed` (no-op), `next build`, `pnpm check:build` | Migrations may already be applied                                                           |
| 5   | Every migration is applied                      | Row count in `drizzle.__drizzle_migrations` must equal the journal                                                                       | Migrations applied, app not deployed                                                        |
| 6   | `vercel deploy --prebuilt --prod --skip-domain` | Uploads a production deployment that doesn't take the domain yet                                                                         | Same                                                                                        |
| 7   | Smoke the unaliased deployment                  | `curl` of `/` and `/api/health` with the protection-bypass header                                                                        | New deployment exists but is not live                                                       |
| 8   | `vercel promote`                                | The new deployment takes `friendsofanimals.dev`                                                                                          | Same                                                                                        |
| 9   | Check the live site                             | `curl https://friendsofanimals.dev/api/health`                                                                                           | **The new version is already live**; a red run here does not mean production was left alone |

Migrations only go forward; redeploying an older commit doesn't undo one.

| Where                               | Name                                                                 | Used for                                                                                |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Environment `production`, secrets   | `VERCEL_TOKEN`, `PROD_DIRECT_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET` | CLI login; migrator connection; smoke bypass                                            |
| Environment `production`, variables | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                                 | Which team and project (these override the repo-level copies; update both)              |
| Repository secrets                  | `VERCEL_AUTOMATION_BYPASS_SECRET`, `CAPTURE_MAILBOX_TOKEN`           | Unused duplicates ([Old names and leftover accounts](#old-names-and-leftover-accounts)) |
| Repository variables                | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                                 | Duplicates                                                                              |

The `production` environment accepts runs only from `main` (a branch could otherwise delete step 1 from its copy of the workflow).

### Live state

Checked 2026-11-24.

- **Production serves `375eb35d`.** No deploy ran during this session, so every merge listed in [Landed this session](#landed-this-session) is waiting. Deploying `main` now applies migrations `0068`-`0078` in one run ([Rule F2](#rule-f2-a-new-enum-value-ships-before-anything-uses-it) explains why that is safe). Neither health endpoint reports a commit; the Vercel deployment's commit tag is the only way to tell.
- `GET /api/health` answers `{"status":"ok","db":{"ok":true,...},"facts":"incomplete"}`. `GET /api/health/worker` answers `ok` for `worker-prod` with a fresh heartbeat.
- All six deploy runs on 2026-11-24 were red. The first failed at `vercel pull` (the Vercel project had just moved), one at build (the F2 failure), three at the smoke step (500 and 503), and the last promoted `375eb35d` and then got a 503 at "Check the live site". The site answers 200 since. The last green run was 2026-11-22 (`646cb692`).
- The dev clone's `/root/friends-of-animals/.vercel/project.json` still points at the old Vercel project, so `vercel` commands there fail with "Not authorized". Run `vercel link` first. `/srv/foa` has no `.vercel/`.

### The VPS

Five Compose projects, all run from `/srv/foa/docker`:

| Compose project | File                   | Containers                                                           | State                              |
| --------------- | ---------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| `foa-vps`       | `docker/compose.yml`   | `foa-pg-prod`, `foa-pg-nonprod`, `foa-pgbouncer`                     | Up, healthy                        |
| `foa-workers`   | `docker/workers.yml`   | `foa-worker-prod`, `foa-clamav`, `foa-gotenberg`                     | Up, healthy                        |
| `foa-workers`   | `docker/workers.yml`   | `worker-staging`, `worker-preview`, `worker-media` (`media` profile) | Not running; no container or image |
| `foa-analytics` | `docker/analytics.yml` | `foa-umami`                                                          | Up                                 |
| `foa-edge`      | `docker/edge.yml`      | `foa-caddy` (host network)                                           | Up                                 |
| `foa-errors`    | `docker/errors.yml`    | `foa-glitchtip`, `foa-glitchtip-pg`                                  | Up                                 |

Check: `docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}'`.

**The production worker runs old code.** The `worker-prod` image was built on 2026-11-22 from `646cb69`, with 14 migrations in its journal against 68 applied in production (`main` has 79, through `0078`). It claims only outbox deliveries whose handler it knows, so deliveries for newer handlers wait, pending, until it is rebuilt. The `/srv/foa` checkout is at `4aab46f2` (2026-11-22).

**Its environment is incomplete.** `/etc/foa/secrets/` has `worker_sentry.env` (errors reach GlitchTip), but no `worker_prod_r2.env` (so upload scans fail and uploads stay unscanned) and no `worker_prod_field_keys.env` (so deliveries that decrypt an address or phone fail and retry). The container also lacks `APP_URL` and `RAZORPAY_*` (refunds sent by the worker are refused). `docker/README.md` "Links and field keys (worker-prod)" and "Scan, PDF and media sidecars" show how to write the files.

### Rebuild the production worker

A production action for the owner. Deploy the same commit to Vercel first: the Vercel build applies migrations and the worker never migrates. Write `/etc/foa/secrets/worker_prod_field_keys.env` first (same keys as Vercel, [The field-key rule](#the-field-key-rule)). Under `docker/`, the pull changes only `workers.yml`, `workers.test.ts` and `README.md`, plus #266's worker bootstrap SQL in `docker/postgres/bootstrap/workers-{prod,nonprod}.sql`, which runs only at provisioning (on production `0072` makes the same grant when Vercel migrates). Nothing in the running database stack changes. New handlers (#262's cancellation messages, #267's breach notices, #266's retention sweep) only run after this rebuild.

```sh
# On the VPS, as root. Restarts the production worker.
cd /srv/foa && git pull --ff-only
cd /srv/foa/docker
WORKER_VERSION=$(git -C /srv/foa rev-parse --short HEAD) \
  docker compose -f workers.yml up -d --build --wait worker-prod
docker compose -f workers.yml ps worker-prod
curl -s https://friendsofanimals.dev/api/health/worker   # "ageSeconds" stays small
```

**Always name `worker-prod`.** `worker-staging` and `worker-preview` have no profile, so a bare `docker compose -f workers.yml up -d` would build and start them too. Logs: `docker compose -f workers.yml logs -f --tail=200 worker-prod`. Starting worker-media is in [Uploads and media](#uploads-and-media).

### Host services and safety nets

| Piece           | What it does                                                                                                                       | Live state                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PgBouncer       | Pooler on `0.0.0.0:6432`, TLS required, SCRAM passwords; Let's Encrypt certificate renewed by lego (`foa-cert-renew.timer`, daily) | Certificate valid to 2027-02-19; no IP allowlist (HR-29 and [Operations](#operations)) |
| Caddy           | TLS edge for `stats.` (Umami) and `errors.` (GlitchTip); serves lego's challenge files on port 80 (`docker/caddy/Caddyfile`)       | Both sites answer 200                                                                  |
| GlitchTip       | Sentry-compatible error tracker for the app and the worker, own Postgres (not backed up)                                           | Up                                                                                     |
| Umami           | Cookieless analytics; its database is on pg-prod                                                                                   | Up, but the site doesn't send to it yet                                                |
| CrowdSec        | Reads PgBouncer and Caddy logs and bans abusive IPs in nftables (`docker/crowdsec/`)                                               | Active                                                                                 |
| Firewall        | `foa-docker-user-fw.service` plus firewalld                                                                                        | Active                                                                                 |
| pgBackRest      | [Backups and restore](#backups-and-restore)                                                                                        | Last full 2026-11-21, last differential 2026-11-23                                     |
| Restore drill   | `foa-restore-drill.timer`, 1st of each month 04:00 IST; results in `/var/log/foa/restore-drills.jsonl`                             | One pass (16.4 s recovery); next 2026-12-01                                            |
| journald        | `docker/systemd/journald-foa.conf`: logs kept 1 year, capped at 20 GiB; every container logs here                                  | Installed                                                                              |
| Uptime workflow | [Other workflows](#other-workflows)                                                                                                | Green but rarely scheduled                                                             |

See all timers with `systemctl list-timers --all | grep -i foa`. Owner tasks for the VPS are also listed under "TODO and owner actions" in `docker/README.md`.

## Environment variables

The source of truth is `src/env.schema.ts`. The server validates its variables at start (`src/instrumentation.ts`) and refuses to start if one is wrong. `next build` needs none outside Vercel. An empty value counts as unset. In app code read config through `env()` from `@/env`, never `process.env`.

**P** = required in production, **S** = required in staging.

| Group         | Variable                                                                                                                    | Required                 | Purpose; behaviour when unset                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core          | `APP_ENV`                                                                                                                   | on Vercel                | `local` (default), `preview`, `staging`, `production` ([`APP_ENV`](#app_env))                                                                                                                                                      |
| Core          | `APP_URL`                                                                                                                   | P, S (build and runtime) | Canonical base URL, baked into prerendered pages and used as Better Auth's base URL. Default `http://localhost:3000`                                                                                                               |
| Database      | `DATABASE_URL`                                                                                                              | always (runtime)         | The app's connection; on Vercel, PgBouncer in transaction mode as `foa_app`                                                                                                                                                        |
| Database      | `DIRECT_URL`                                                                                                                | for migrations           | `db:migrate`, `db:seed`, `admin:bootstrap-super-admin`, drizzle-kit. Never falls back to `DATABASE_URL`                                                                                                                            |
| Auth          | `BETTER_AUTH_SECRET`                                                                                                        | P, S                     | Signs session cookies, seals authenticator secrets. 32+ characters. Unset: a public development secret                                                                                                                             |
| Auth          | `CAPTURE_MAILBOX_TOKEN`                                                                                                     | no                       | Opens `/api/capture-mailbox` and `/api/preview/drain`. 32+ characters. Never set in production                                                                                                                                     |
| Crypto        | `FIELD_ENCRYPTION_KEYS`                                                                                                     | P, S                     | Key ring `"<version>:<base64 32 bytes>,..."`; the highest version encrypts. Unset: public development keys                                                                                                                         |
| Crypto        | `FIELD_HMAC_KEY`                                                                                                            | P, S                     | Blind-index key (base64, 32 bytes)                                                                                                                                                                                                 |
| Email         | `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_FROM`                                                                    | all three or none        | Production email; unset means production refuses to send                                                                                                                                                                           |
| Email         | `SES_REGION`, `SES_CONFIGURATION_SET`, `SES_PRODUCTION_ACCESS`                                                              | no                       | Defaults `ap-south-1`, none, `false`. Email sign-in stays off until `SES_PRODUCTION_ACCESS=true`. Tracked sends (#262's cancellation email) are refused without `SES_CONFIGURATION_SET`, a configuration set with event publishing |
| SMS           | `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_COORDINATOR_INVITATION_TEMPLATE_ID`                                       | no                       | Production SMS; unset means production refuses                                                                                                                                                                                     |
| Payments      | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`                                                         | all three or none        | [Payment gateway](#payment-gateway)                                                                                                                                                                                                |
| Storage       | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`                                                    | all four or none         | Private uploads in R2. Unset: a deployment refuses uploads, a local run uses disk                                                                                                                                                  |
| Storage       | `PUBLIC_ASSET_BASE_URL`                                                                                                     | no                       | https origin of the public bucket; unset hides uploaded post images                                                                                                                                                                |
| Observability | `NEXT_PUBLIC_SENTRY_DSN`                                                                                                    | P (build and runtime)    | The app's GlitchTip DSN                                                                                                                                                                                                            |
| Analytics     | `NEXT_PUBLIC_UMAMI_WEBSITE_ID`, `UMAMI_ORIGIN`                                                                              | no                       | Umami; only staging and production builds with both set send anything. The VPS serves `https://stats.friendsofanimals.dev`                                                                                                         |
| Scanner       | `CLAMD_HOST`, `CLAMD_PORT` (3310)                                                                                           | no                       | clamd. Never set on Vercel                                                                                                                                                                                                         |
| Set by Vercel | `VERCEL`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_PULL_REQUEST_ID`, `VERCEL_GIT_COMMIT_REF` | automatic                | Platform values; don't set them                                                                                                                                                                                                    |

Test-only: `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_GUARDIAN_PAUSED_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET` (inert leftover), `OFFSITE_CONTRACT*`.

### Worker-only variables

`src/worker/config.ts`. The worker also reads `APP_ENV`, `APP_URL`, `FIELD_*`, `R2_*`, `CLAMD_*`, `RAZORPAY_*` and `SENTRY_DSN`.

| Variable                                                                                                                                                                                           | Default                            | Purpose                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_MODE`                                                                                                                                                                                      | `single`                           | `single` drains one database; `preview` lists preview databases (needs `WORKER_ADMIN_URL`)                                                                                                   |
| `WORKER_DATABASE_URL`                                                                                                                                                                              | local: `DIRECT_URL`                | Direct connection, not PgBouncer                                                                                                                                                             |
| `WORKER_ADMIN_URL`                                                                                                                                                                                 | none                               | Preview mode only                                                                                                                                                                            |
| `WORKER_PASSWORD_FILE`                                                                                                                                                                             | none                               | File holding the database password (a Compose secret)                                                                                                                                        |
| `WORKER_QUEUE`                                                                                                                                                                                     | `default`                          | `media` makes it worker-media                                                                                                                                                                |
| `WORKER_POLL_SECONDS`, `WORKER_DISCOVERY_SECONDS`                                                                                                                                                  | 5, 60                              | Drain interval; preview discovery interval                                                                                                                                                   |
| `WORKER_CONNECTIONS_PER_DATABASE`                                                                                                                                                                  | 1 (max 2)                          | Pool size per database                                                                                                                                                                       |
| `WORKER_HEARTBEAT_FILE`, `WORKER_VERSION`                                                                                                                                                          | `/tmp/foa-worker-heartbeat`, `dev` | Health file; build commit                                                                                                                                                                    |
| `MEDIA_TIMEOUT_SECONDS`                                                                                                                                                                            | 60 (max 240)                       | Media queue only                                                                                                                                                                             |
| `SENTRY_DSN`                                                                                                                                                                                       | none                               | Worker error tracking                                                                                                                                                                        |
| `OFFSITE_SOURCE_BUCKETS`, `OFFSITE_RETENTION_DAYS` (30), `OFFSITE_R2_ACCESS_KEY_ID`, `OFFSITE_R2_SECRET_ACCESS_KEY`, `B2_S3_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | none                               | Off-site copy, worker-prod only; also needs `R2_ACCOUNT_ID`. Each can be given as `<NAME>_FILE`. `pnpm offsite:restore` reads `OFFSITE_RESTORE_R2_ACCESS_KEY_ID` and `..._SECRET_ACCESS_KEY` |

### Where production values live

Names only; never commit values.

- **The app:** the Vercel project's Production environment. It has `APP_ENV`, `APP_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `FIELD_ENCRYPTION_KEYS`, `FIELD_HMAC_KEY` and `NEXT_PUBLIC_SENTRY_DSN`. It has none of `SES_*`, `MSG91_*`, `RAZORPAY_*`, `R2_*` or `UMAMI_*` yet.
- **Migrations at deploy time:** the GitHub `production` environment secret `PROD_DIRECT_URL`.
- **The VPS** (the source of truth if Vercel values ever need re-copying; never generate new field keys):
  - `/etc/foa/secrets/`: database passwords (Compose secrets), `worker_sentry.env`.
  - `/etc/foa/secrets/app/`: the app's field keys (`field_encryption_keys`, `field_hmac_key`).
  - `/etc/foa/vercel-urls.env`: the `..._DATABASE_URL` and `..._DIRECT_URL` values for Vercel.
  - `/etc/foa/secrets/owner/ses.env`: AWS keys, not used by the app yet.
  - Optional worker env files named in `docker/workers.yml`: `worker_prod_r2.env`, `worker_media_r2.env`, `worker_prod_field_keys.env`. **None exists today.**

### The field-key rule

`FIELD_ENCRYPTION_KEYS` and `FIELD_HMAC_KEY` must be **identical** in the Vercel app and in worker-prod (`/etc/foa/secrets/worker_prod_field_keys.env`). With different keys the worker can't read what the app stored. **Keep an offline copy of both.** A lost encryption key loses every value encrypted under it. A changed HMAC key breaks every lookup until all blind indexes are recomputed. To rotate: add version 2 to the ring, re-encrypt, then drop version 1; update the app and worker-prod together.

## Owner-only blockers and the HR register

Some work needs a person, not code: accounts, keys, KYC, DNS, legal text and FOA decisions. Agents gave each such item an ID from `HR-01` to `HR-67` ("human residue"). Code comments cite these IDs, and this section is now the only place that defines them.

Most go-live work waits on one chain:

```text
AWS approves SES ─► email sign-in works ─► bootstrap the first super admin ─► staff sign in, enrol a second factor, get roles
                                                                               ├─► enter FOA's real facts
                                                                               └─► publish the consent documents counsel approved
```

### Go-live

1. **Fix production settings on the Vercel project** (ACME team, project `friends-of-animals`). Set `APP_URL` to `https://friendsofanimals.dev`; it is still `https://friends-of-animals.vercel.app`, which the canonical links, `sitemap.xml`, `robots.txt` and Better Auth all use. Add `UMAMI_ORIGIN=https://stats.friendsofanimals.dev` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID` (from Umami) to turn analytics on (HR-52). All three are plain variables. Then deploy `main` ([Production deploys](#production-deploys); run the F2 check first) and confirm the run is green.
2. **Remove leftovers on the same project:** the custom environment `staging` and the domains `shipped-it.dev` and `www.shipped-it.dev` ([Old names and leftover accounts](#old-names-and-leftover-accounts)).
3. **Name FOA's staff** (HR-17): super admins, two finance approvers, the safeguarding lead and a deputy, a grievance officer, two results approvers. Each enrols a second factor.
4. **Bootstrap the first super admin** (HR-18) once email sign-in works. On the VPS, in a checkout of `main` after `pnpm install`:
   ```sh
   DIRECT_URL="$(sed -n 's/^PROD_DIRECT_URL=//p' /etc/foa/vercel-urls.env)" \
     pnpm admin:bootstrap-super-admin --email <address> --name "<name>" --target <host>/<database>
   ```
   Without `--target` it refuses and its message names the exact value. Grant the other roles at `/admin/roles`.
5. **Enter FOA's real facts** (HR-21). A super admin sets the legal name, registration type and number and the PAN at `/admin/settings`. A content manager publishes the email, phone, address, grievance officer and social links in the `site_facts` document at `/admin/cms`. Then `/api/health` stops saying `"facts":"incomplete"`.

### Email sign-in

1. **Reply to AWS Support case 179526224900669** (SES in `ap-south-1`; production access denied on 2026-11-21). Say the mail is transactional only (sign-in codes, receipts), under 200 a day at first, with the suppression list on. DKIM, SPF on `mail.friendsofanimals.dev` and DMARC are in DNS. Whether anyone has replied since is unverified.
2. **After approval, narrow the key.** The `foa-ses` IAM user has `AmazonSESFullAccess`. Make a runtime key limited to `ses:SendEmail` and `ses:SendRawEmail` on the identity `friendsofanimals.dev`. In Vercel Production set `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` (sensitive), `SES_FROM` (a no-reply sender on `friendsofanimals.dev`) and `SES_PRODUCTION_ACCESS=true`, then redeploy (HR-12).
3. For #262's cancellation email (a tracked send), also create an SES configuration set with event publishing and set `SES_CONFIGURATION_SET`; without it `email-ses.ts` refuses the send ("Tracked SES email requires a configuration set with event publishing").
4. Sign-in codes go straight from the app, so step 2 is enough for sign-in. Queued email from the worker still fails until the worker's sender is fixed ([Code gaps](#code-gaps)).

### SMS

FOA registers on DLT (India's SMS sender registry) through MSG91: the principal entity, a sender header (`FOAIND` was proposed) and every SMS template with its `dlt_template_id`. Then set `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` and `MSG91_COORDINATOR_INVITATION_TEMPLATE_ID` in Vercel Production, redeploy, and have a super admin turn on `sms.enabled` (HR-14; #58, #74).

### Payments and accounting

1. **Razorpay live** (HR-15): NGO KYC and the signatory's video KYC. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (all three, `rzp_live_` only) in Vercel Production. Point a webhook at `https://friendsofanimals.dev/api/webhooks/razorpay` for `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed` and `refund.failed`. Worker-prod also needs the three to send refunds, but `docker/workers.yml` has no env file for them yet: add one (for example `/etc/foa/secrets/worker_prod_razorpay.env`) in a PR, then recreate worker-prod.
2. **Tax and accounting:** 12A/80G registration (HR-16; `org.has80G` stays off until then); the accountant's rulings on the chart of accounts, receipts and export (HR-47); fee and refund defaults (HR-34).

### Uploads and media

1. **FOA's Cloudflare R2** (HR-13): a private production bucket, its `<bucket>-public` twin on a custom domain, and scoped tokens.
   - App: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `PUBLIC_ASSET_BASE_URL` in Vercel Production.
   - Upload scans: the same four `R2_*` lines in `/etc/foa/secrets/worker_prod_r2.env` (root, 0600), then recreate worker-prod.
   - Image derivatives: a read-write token in `/etc/foa/secrets/worker_media_r2.env`, then start worker-media (HR-35):
     `cd /srv/foa/docker && WORKER_VERSION=$(git -C /srv/foa rev-parse --short HEAD) docker compose -f workers.yml --profile media up -d --build --wait worker-media foa-gotenberg`
2. **Off-site copy of files** (HR-25, #68): a B2 bucket with SSE-B2 encryption and prior versions kept 1 to 7 days, an application key limited to it, and a read-only R2 token. Put them in `/etc/foa/secrets/owner/` and wire them as in `docker/README.md`, "Settings (worker-prod only)".

### Minors

Guardian setup, new minor participation and consent links run only when `APP_ENV` is `local` or `preview` (PR #279). Paper consent forms (`consent_form` file purpose) are refused only in production. To turn them on in production:

1. The safeguarding lead signs off the guardian, teen (13-17) and under-13 flows (HR-32).
2. Counsel and FOA approve the consent documents and competition terms (HR-33); staff publish them at `/admin/consent-documents`.
3. An agent changes `guardianFlowsActive` (`src/server/modules/guardians/availability.ts`), `consentLinksActive` (`src/server/modules/consent-links/repository.ts`) and the `consent_form` file purpose to allow production.

### Legal and privacy

1. Counsel approves the M0 legal copy (HR-20): privacy notice, terms, messages consent, sign-up notice. The text in `src/content/legal/` is agent-written draft. Production has no consent versions; staff publish version 1 after approval.
2. Counsel rules on DPDP (India's Digital Personal Data Protection Act) questions (HR-30): parental consent method, own login from 13, the school as joint fiduciary, minors' public credits, data residency (B2 has no India region), audit retention versus erasure, 365-day IP logs, the withdrawal SLA.
3. Counsel and the accountant confirm retention periods (HR-31): every period in `src/server/modules/privacy/inventory.ts` says `toConfirm: true`. Then a super admin turns on `retention.enforce`.
4. Breach readiness (HR-49): the DPB and CERT-In channel (then set `breach.authorityEmail`), pre-approved notices, police and SJPU contacts, a 24x7 on-call.

### Operations

1. **Make offline copies now** of `/etc/foa/secrets/app/*` (the field keys) and `/etc/foa/secrets/pgbackrest_repo1_cipher_pass` (password manager or encrypted USB stick). Losing a key loses the data under it for good (HR-05; done or not is unverified).
2. **Rebuild worker-prod from `main`** after deploying: [Rebuild the production worker](#rebuild-the-production-worker) (the worker's keys and env files: HR-05, HR-12, HR-13).
3. **Off-box database backups:** add pgBackRest `repo2` (HR-25; no open issue).
4. **Alerting:** nothing alerts when `foa-pgbackrest-*`, `foa-restore-drill`, `foa-cert-renew` or WAL archiving fails. Confirm that a failed Uptime run emails you (HR-23; `docker/README.md`, "Monitoring and alerts"). Pick a 365-day log store and add a Vercel log drain (HR-24).
5. **Firewall:** PgBouncer is open on `0.0.0.0:6432` with no allowlist (`/etc/foa/firewall.env` does not exist); TLS, SCRAM and CrowdSec protect it. An allowlist needs paid Vercel Static IPs for functions, plus a way for the GitHub Actions deploy job (which runs the migrations) to reach 6432, or the migration step must move to the VPS. If the Hostinger panel firewall is ever turned on, allow 22 first, then 80, 443 and 6432.
6. **Accounts:** change the GlitchTip admin password (no mail reset; `/etc/foa/secrets/glitchtip_admin.env`); turn on Umami two-factor (`/etc/foa/secrets/umami_admin_password`). HR-29: run `vercel logout` on the VPS (still signed in), rotate the database passwords agent sessions handled, settle Hostinger disk encryption and Static IPs.
7. **Later:** real-device checks before big UI releases (HR-28); the pilot prerequisites, including written acceptance of the VPS-loss risk (HR-54).

### Defaults and decisions

- **Defaults FOA should confirm** (they ship; nothing waits on them): HR-19, 34, 37, 40, 46, 51, 57, 62, 66.
- **Design sign-offs:** HR-42, 43, 67.
- **Decisions for features not built yet:** HR-58, 59, 60, 63, 64 ([Tickets blocked on owner items](#tickets-blocked-on-owner-items)).
- **Copy approvals for later features:** HR-36, 39, 45, 50, 56, 61, 65.

### HR register: open items

52 open items. "Later" means the feature is not built yet.

| ID    | Item                                                                                                                                                                                                                                                                                                                     | Evidence today                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| HR-05 | Field-encryption and HMAC keys, offline backup                                                                                                                                                                                                                                                                           | Production keys set; backup unconfirmed; worker lacks keys                        |
| HR-12 | SES production access, DNS, narrow key, keys in Vercel                                                                                                                                                                                                                                                                   | Case denied; no `SES_*` in Vercel                                                 |
| HR-13 | FOA R2 production account, buckets, tokens, CDN                                                                                                                                                                                                                                                                          | No `R2_*` in Vercel; no worker R2 files                                           |
| HR-14 | DLT via MSG91, templates, MSG91 keys                                                                                                                                                                                                                                                                                     | No `MSG91_*`; `sms.enabled` off                                                   |
| HR-15 | Razorpay live KYC and keys                                                                                                                                                                                                                                                                                               | No `RAZORPAY_*` in Vercel                                                         |
| HR-16 | 12A/80G registration                                                                                                                                                                                                                                                                                                     | `org.has80G` off                                                                  |
| HR-17 | Named staff with second factor                                                                                                                                                                                                                                                                                           | Nobody can sign in to production yet                                              |
| HR-18 | Bootstrap the production super admin                                                                                                                                                                                                                                                                                     | Needs HR-12                                                                       |
| HR-19 | M0 defaults: codes, sessions, step-up, CSP rollout                                                                                                                                                                                                                                                                       | Defaults live; CSP Report-Only; not confirmed                                     |
| HR-20 | M0 legal copy                                                                                                                                                                                                                                                                                                            | Drafts await counsel                                                              |
| HR-21 | Real FOA facts                                                                                                                                                                                                                                                                                                           | `/api/health`: `"facts":"incomplete"`                                             |
| HR-23 | Uptime checks and alert receipt                                                                                                                                                                                                                                                                                          | `uptime.yml` green; receipt unconfirmed                                           |
| HR-24 | 365-day logs, Vercel drain                                                                                                                                                                                                                                                                                               | VPS journald set; no drain or store                                               |
| HR-25 | Off-site B2 copy of files, pgBackRest repo2                                                                                                                                                                                                                                                                              | No B2 files; only repo1                                                           |
| HR-28 | Real-device checks                                                                                                                                                                                                                                                                                                       | Non-blocking                                                                      |
| HR-29 | Hygiene: rotate database passwords, `vercel logout`, disk encryption, Static IPs                                                                                                                                                                                                                                         | Vercel CLI still signed in on the VPS                                             |
| HR-30 | Counsel's DPDP rulings                                                                                                                                                                                                                                                                                                   | None recorded                                                                     |
| HR-31 | Retention periods                                                                                                                                                                                                                                                                                                        | All `toConfirm: true`                                                             |
| HR-32 | M1 safeguarding sign-off                                                                                                                                                                                                                                                                                                 | Guardian flows off in production                                                  |
| HR-33 | M1 legal copy: consents, competition terms, printable signed form, and the "required by law" message list (refund notices to the payer; competition-cancelled notices to coordinators, adults and guardians, #80)                                                                                                        | Drafts in `src/content/legal/`; message routes ship with `required_by_law = true` |
| HR-34 | M1 defaults: fees, refunds (no refund after confirmation except cancellation or duplicates; finance approves discretionary refunds behind step-up), offline payments, and cancelling a competition (super admin behind step-up, reason 1-500 characters, every paid fee refunded without approval, offline fees by hand) | Defaults ship; confirm                                                            |
| HR-35 | Deploy worker-media                                                                                                                                                                                                                                                                                                      | Not running; needs its R2 file                                                    |
| HR-36 | M2 copy                                                                                                                                                                                                                                                                                                                  | Announcements and entries landed                                                  |
| HR-37 | M2 defaults: file sizes, reminders, rubric scale                                                                                                                                                                                                                                                                         | Defaults ship; confirm                                                            |
| HR-38 | Police checks of judges and volunteers                                                                                                                                                                                                                                                                                   | Later (#95, #123)                                                                 |
| HR-39 | M3 legal copy: judge conduct, confidentiality                                                                                                                                                                                                                                                                            | Later (#95)                                                                       |
| HR-40 | M3 defaults: artwork logistics, tie-break                                                                                                                                                                                                                                                                                | Later (#93, #96)                                                                  |
| HR-42 | Certificate design sign-off                                                                                                                                                                                                                                                                                              | Later (#100, #124)                                                                |
| HR-43 | Logo stamping sign-off                                                                                                                                                                                                                                                                                                   | Later (#102)                                                                      |
| HR-44 | M4 safeguarding: credits, gallery, takedown                                                                                                                                                                                                                                                                              | Later (#99-#104)                                                                  |
| HR-45 | M4 copy                                                                                                                                                                                                                                                                                                                  | Later                                                                             |
| HR-46 | M4 defaults                                                                                                                                                                                                                                                                                                              | Later                                                                             |
| HR-47 | Accountant: receipts, chart of accounts, export                                                                                                                                                                                                                                                                          | Ledger landed with a provisional chart                                            |
| HR-48 | M5 safeguarding: report form, breach process, quick exit                                                                                                                                                                                                                                                                 | Code landed; sign-off pending                                                     |
| HR-49 | Breach channel, notices, on-call                                                                                                                                                                                                                                                                                         | Breach log landed; `breach.authorityEmail` empty                                  |
| HR-50 | M5 copy: legal pages, contact acknowledgement, donation messages                                                                                                                                                                                                                                                         | Partly later (#106-#110, #115)                                                    |
| HR-51 | M5 defaults: donations, approvals, SLAs, proof-of-work difficulty                                                                                                                                                                                                                                                        | Partly later                                                                      |
| HR-52 | Umami                                                                                                                                                                                                                                                                                                                    | Running; website ID and origin missing on Vercel; two-factor unconfirmed          |
| HR-54 | Pilot prerequisites                                                                                                                                                                                                                                                                                                      | Not recorded                                                                      |
| HR-55 | M6 safeguarding: volunteers, clubs                                                                                                                                                                                                                                                                                       | Later (#121, #123)                                                                |
| HR-56 | M6 copy                                                                                                                                                                                                                                                                                                                  | Later                                                                             |
| HR-57 | M6 defaults                                                                                                                                                                                                                                                                                                              | Later                                                                             |
| HR-58 | Invitations go or no-go, backfill                                                                                                                                                                                                                                                                                        | Later (#120)                                                                      |
| HR-59 | Pin-code data licence and import                                                                                                                                                                                                                                                                                         | Later (#128)                                                                      |
| HR-60 | `earthdistance` extension if needed                                                                                                                                                                                                                                                                                      | Later, conditional (#128)                                                         |
| HR-61 | M7 copy                                                                                                                                                                                                                                                                                                                  | Later (#127-#130)                                                                 |
| HR-62 | M7 defaults                                                                                                                                                                                                                                                                                                              | Later                                                                             |
| HR-63 | Auctions of minors' work, creator share                                                                                                                                                                                                                                                                                  | Later (#131)                                                                      |
| HR-64 | Accountant: auction GST, payouts                                                                                                                                                                                                                                                                                         | Later (#133)                                                                      |
| HR-65 | M8 copy                                                                                                                                                                                                                                                                                                                  | Later                                                                             |
| HR-66 | M8 defaults                                                                                                                                                                                                                                                                                                              | Later                                                                             |
| HR-67 | Favicon: paw tile alone?                                                                                                                                                                                                                                                                                                 | Cosmetic; blocks nothing                                                          |

### HR register: done and obsolete

- **Done (8):** HR-01 `BETTER_AUTH_SECRET` per environment; HR-07 worker database roles and `workers.yml`; HR-08 ClamAV sidecar (its R2 part moved to HR-13); HR-11 production domain on Vercel; HR-22 error-tracking DSNs (GlitchTip); HR-26 restore-drill timer; HR-41 Gotenberg 9; HR-53 captcha choice (self-hosted proof of work).
- **Obsolete (7)**, tied to PR previews, the old staging site or milestone branches, none of which exist: HR-02 capture token in `e2e.yml`; HR-03 GitHub token for the preview sweeper; HR-04 Vercel "one build per branch"; HR-06 non-production R2 buckets; HR-09 Razorpay test mode for previews; HR-10 rebuild worker-preview per milestone; HR-27 per-milestone staging checks.

## How to work a ticket

The only git remote is `foa`, not `origin`. Paths assume the clone is `/root/friends-of-animals`, so worktrees land beside it as `/root/foa-<n>`. Issue-tracker rules are also in [`CLAUDE.md`](CLAUDE.md).

### The loop

1. **Pick a ticket** from [Next tickets you can pick up](#next-tickets-you-can-pick-up) and confirm it is startable:
   ```sh
   gh api repos/SiddharthMuramkar/friends-of-animals/issues/<n> --jq .issue_dependencies_summary.blocked_by   # 0
   ```
2. **Fetch and branch** in a fresh worktree from the latest `main`. Branch names are `ticket/<n>-<slug>`:
   ```sh
   cd /root/friends-of-animals
   git fetch foa
   git worktree add ../foa-<n> -b ticket/<n>-<slug> foa/main
   cd ../foa-<n>
   ```
3. **Read the issue and its context:** `gh issue view <n> --json number,title,body,labels,comments`. Read the matching module in [Domain modules](#domain-modules), the unit scope on the board, and the archived draft if there is one ([Restore an archived draft branch](#restore-an-archived-draft-branch)). Use `GLOSSARY.md` words; call out anything that contradicts an ADR. Read the Next.js docs in `node_modules/next/dist/docs/` before writing Next code (`AGENTS.md`).
4. **Install.** Each worktree needs its own `node_modules`:
   ```sh
   pnpm install
   cp .env.example .env    # only for pnpm dev, db:* or test:pg; .env* is git-ignored
   ```
5. **Write the tests first** ([Seam 1](#seam-1-use-case-tests-through-the-harness)): an allowed-role and a refused-role test per use case, a `*.pg.test.ts` for any race, and a Playwright journey `tests/e2e/<n>-<slug>.spec.ts` with axe checks for new pages. Then write the code until they pass. Schema changes follow [Adding a migration](#adding-a-migration) and [Rule F2](#rule-f2-a-new-enum-value-ships-before-anything-uses-it). New UI strings go in `messages/en-IN/`.
6. **Run the full check:** `pnpm check`, and `pnpm build && pnpm check:build` if you changed pages, config or client code.
7. **Commit and push.** Subjects follow `M<milestone> #<n>: <what changed, as a sentence>`, for example `M5 #105: Add staff ledger journeys`.
   ```sh
   git push -u foa ticket/<n>-<slug>
   ```
8. **Open the PR** with the body below:
   ```sh
   gh pr create --base main --title "M<k> #<n>: <title>" --body-file /tmp/pr-<n>.md
   gh pr edit <pr> --add-label full-ci
   ```
   Write `Closes #<n>` **only if this PR finishes the ticket**. Otherwise write `Refs #<n>` and name the unit, for example "Unit 84b".
9. **Merge** when "CI gate" is green on a branch up to date with `main`. If `main` moved, update and wait again. If someone else's migration took your number, [regenerate](#when-another-branch-landed-migrations-first).
   ```sh
   gh pr update-branch <pr>
   gh pr merge <pr> --merge          # or --merge --auto
   ```
10. **Clean up:**
    ```sh
    cd /root/friends-of-animals
    git worktree remove ../foa-<n>
    git branch -D ticket/<n>-<slug>
    git fetch foa --prune
    ```
11. **Close the issue** if the PR said `Refs` and the ticket is now finished: comment with the evidence, then `gh issue close <n>`. Update this README's board in the same or a follow-up PR.
12. **Production** is a separate, manual owner step ([Production deploys](#production-deploys)). Merging does not deploy.

### PR body

Use this template. Skip preambles, keep prose short, use `GLOSSARY.md` words.

```markdown
## Summary

<the smallest view that makes the point: a call tree, file tree, diff sketch, pseudocode or Mermaid diagram>

## Evidence

- **Before:** <screenshot, output or failing test run>
  **After:** <screenshot, output or passing test run>

## Merge Danger

**Door:** <one-way or two-way> (a migration or data change is one-way)

**Blast Radius:** <one word>

<optional: what could go wrong after merge>

## Residue

<HR items or follow-ups this PR leaves, by ID>

## Not run

<checks you could not run, and why>

Refs #<n> (Unit <id>) or Closes #<n>
```

## Known gaps and cleanup candidates

### Production issues found

| Issue                                                                    | Effect                                                                       | Fix                                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Vercel `APP_URL` is the old `vercel.app` host                            | Wrong canonical links, sitemap and `robots.txt`                              | [Go-live](#go-live) step 1                                                                                                          |
| `UMAMI_*` missing on Vercel                                              | No analytics                                                                 | [Go-live](#go-live) step 1                                                                                                          |
| This session's merges are not deployed                                   | Production lacks `0068`-`0078` and every new page                            | One deploy of `main` is F2-safe ([Rule F2](#rule-f2-a-new-enum-value-ships-before-anything-uses-it)); rerun the check if more lands |
| worker-prod runs `646cb69` without R2, field keys, `APP_URL` or Razorpay | New handlers' deliveries wait; scans, decrypting deliveries and refunds fail | [Rebuild the production worker](#rebuild-the-production-worker) plus the env files                                                  |
| worker-media not running                                                 | No image derivatives, so entries never become `live` in production           | HR-13, HR-35                                                                                                                        |
| Deploys go red at the smoke steps (500 or 503 right after a deploy)      | A red run may still have promoted                                            | Check the deployment tag; consider a retry before failing step 9                                                                    |
| `uptime.yml` runs rarely                                                 | Outages go unnoticed                                                         | External uptime monitor; HR-23                                                                                                      |
| No alerts on failed backups, drills or certificate renewal               | Silent failures                                                              | [Operations](#operations) step 4                                                                                                    |
| No off-site database or file copy                                        | Losing the VPS loses everything                                              | HR-25 (no open issue tracks it)                                                                                                     |
| PgBouncer has no IP allowlist                                            | Open to the internet (TLS, SCRAM, CrowdSec only)                             | [Operations](#operations) step 5                                                                                                    |

### Code gaps

- **The worker refuses outbox email and SMS in production.** `src/worker/worker.ts` builds its senders with an empty config, so welcome, confirmation, acknowledgement and notification messages fail even after SES and MSG91 keys exist. Fix: pass the SES and MSG91 config to the worker and its env files. Sign-in codes are not affected.
- **No idempotency key on the email and SMS ports.** If the worker dies after a send but before marking the row, the retry sends again (`notifications/dispatch.ts` header). #262 added an optional `deliveryId` to `EmailSender.send` and a `competition_cancellation_email` send record for the cancellation email only; other sends are unchanged.
- **No payment reconciliation sweep.** Nothing re-checks open batches against the gateway; comments say "later a sweep" (`payments/domain/capture-decision.ts`, `sync-batch.ts`). The nightly ledger job only posts missed captures and refunds.
- **Contact-only breach recipients.** #267 noted them as a follow-up. (The breach log's retention is registered with the sweep as `BREACH_RECORDS`.)
- **Cancelled competitions while refunds are pending.** Entry upload (#85) and announcement sends (#84) don't check whether the competition was cancelled while its refunds are still pending (#262).
- **Guardian link with a different email** (open product question from #264). A verified guardian link whose email differs from the roster email gets its own copy of an announcement on retry, under main's #273 identity rules.
- **Retention is a dry run everywhere.** `retention.enforce` defaults to false. Capture mailboxes no longer prune on send and verification cleanup is off, so on staging captured messages and expired verifications pile up. Owner action: a super admin turns `retention.enforce` on for staging (production waits on HR-31).
- **Flaky E2E on `main`.** Three of this session's merge runs failed in E2E (two Chromium-install runner timeouts, one flaky `70-competitions-admin.spec.ts`); rerun with `gh run rerun <id> --failed` ([Testing and CI](#testing-and-ci)).
- **Rule F2 is not enforced** by any check ([Rule F2](#rule-f2-a-new-enum-value-ships-before-anything-uses-it)). A CI step that runs the helper against production's applied count would catch it.
- **No page** calls `resetSecondFactors`, `listCompetitionEntries`, `getFileDerivativeUrl` or `myGuardians`; message routes have no admin page; an adult can't withdraw their own unpaid registration.
- **Competition statuses stop at `school_judging`.**

### Dormant preview machinery

The old design gave each PR a Vercel preview with its own database on pg-nonprod, copied from `foa_seed`. ADR 0001 dropped previews, but the code remains:

- `scripts/preview-database.ts` (called by `scripts/migrate.ts` when `APP_ENV=preview`), `src/server/db/database-url.ts` preview naming, `src/worker/preview-databases.ts` and `WORKER_MODE=preview`, `docker/scripts/sweep-preview-dbs.sh`, `docker/scripts/preview-dropped.d/50-purge-files.sh`, `scripts/purge-preview-files.ts` (`pnpm files:purge-preview`), `src/app/api/preview/drain/` (still used by E2E as the drain route), `tests/e2e/vercel-bypass.ts` (inert without its secret), and `worker-staging`/`worker-preview` in `docker/workers.yml`.
- None of it runs. Vercel makes no previews; the sweep timer is not installed (only `foa-preview-sweep.service` is linked); `worker-preview` has no image. `docker/scripts/install-systemd.sh` would re-enable the sweep timer if run again.
- pg-nonprod still holds 21 `foa_br_*` preview databases, `foa_staging` (never migrated) and the unused `staging_*` and `nonprod_*` roles.

Candidates: delete the preview code paths (keep the drain route, renamed), drop the `foa_br_*` databases, and decide whether `APP_ENV=preview` and `staging` stay.

### Old names and leftover accounts

- **`shipped-it.dev`**, the old domain: still in `docker/caddy/Caddyfile` (`http://db.shipped-it.dev`), `docker/edge.test.ts`, `docker/README.md`, the sample Umami origin in `.env.example`, `src/env.schema.ts` and `src/lib/analytics/umami.ts` plus their tests (`src/env.schema.test.ts`, `src/lib/analytics/umami.test.ts`, `src/lib/analytics/tracker-island.test.ts`), and `src/lib/seo.test.ts`, and on the PgBouncer certificate. On Vercel, `shipped-it.dev` and `www.shipped-it.dev` are still attached and serve an old build whose `/api/health` reports a database error.
- **GitHub environments** left from Vercel's GitHub integration: `Preview`, `Preview – friends-of-animals`, `Production – friends-of-animals`. They hold no secrets and nothing uses them. Delete them.
- **Repository secrets and variables:** `CAPTURE_MAILBOX_TOKEN` (no workflow reads it), and repo-level copies of `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` that the `production` environment overrides.
- **Vercel custom environment `staging`** on the production project (ADR 0001 says there is no staging), with its own variables (including `APP_URL=https://shipped-it.dev`).
- **Vercel Preview-target variables:** `APP_ENV`, `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET` and `CAPTURE_MAILBOX_TOKEN` (pointing at pg-nonprod). Nothing builds previews; delete them.
- **The abandoned repo `siddhartxts/friends-of-animals`**: the project's first home, public, last pushed 2026-11-21, with 85 open issues that duplicate this repo's. Archive it (or make it private) so nobody works there by mistake.
- **shadcn leftovers:** `components.json` still names `@/components/ui`, and `.oxlintrc.json` still exempts `src/components/ui/**` from the literal-string rule. Both can go. The `shadcn` devDependency stays for now: `src/app/globals.css` imports `shadcn/tailwind.css`, so removing the package breaks the CSS unless that import goes too.
- `src/server/db/schema/index.ts` exports `./contact` and `./public-forms` twice (harmless union-merge leftovers).

### Restore an archived draft branch

Before the cleanup every branch was saved in `/root/foa-archive/all-refs-2026-11-24.bundle`, with an index in `/root/foa-archive/branches.tsv` (columns: branch, sha, where, status, ticket, date, subject). Rows marked `unmerged(N)` are the drafts; the ticket number is column 5. `/root/foa-archive/README.txt` describes the rest of the archive (the old agent tooling is in `foa-work.tar.zst`).

```sh
cd /root/friends-of-animals
git fetch /root/foa-archive/all-refs-2026-11-24.bundle refs/heads/<branch>:refs/heads/draft/<name>
git log --oneline foa/main..draft/<name>                         # the draft's own commits
git diff $(git merge-base foa/main draft/<name>) draft/<name> --stat
```

Example: `git fetch /root/foa-archive/all-refs-2026-11-24.bundle refs/heads/ticket/84-reminders:refs/heads/draft/84b`.

Rows with `where=remote` (`ci/e2e-capture-token`, `claude/stoic-thompson-ukn0dx`, `docs/entry-submission`, `salvage/111b`) exist only as `refs/remotes/foa/<branch>` in the bundle; fetch `refs/remotes/foa/<branch>` for those. All 57 ticket drafts are under `refs/heads/`.

Copy what is useful into your `ticket/<n>-<slug>` worktree by hand or with `git checkout draft/<name> -- <path>`. Never merge a draft branch: it is far behind `main` and its migrations clash. Delete it when done: `git branch -D draft/<name>`. The archive lives only on the VPS; copy it elsewhere if you want to keep it.
