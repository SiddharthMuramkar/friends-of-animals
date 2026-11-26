# Video 2: Friends of Animals platform, developer handover

**Audience:** the developers taking over the code, the VPS and the Docker stack
**Length:** about 17–18 minutes (about 2,100 spoken words, plus time on commands)
**Recording setup:** see the [Appendix](#appendix-recording-setup). Record the terminal at a large font (18 pt) and the browser at 125%.

Every command and path below is taken from `README.md` or `docker/README.md` in the repo. Those two files are the real handbook. This video is the tour.

---

## Scene 1: Who this is for (0:00–0:45)

**On screen:** the repo on GitHub, then `README.md` scrolling past its contents list.

**Say:**

> This is the developer handover for the Friends of Animals platform. You're taking over a finished build: every ticket in the spec is closed. But production is only partly switched on, because several outside accounts are still waiting on FOA. In the next eighteen minutes I'll cover how the system is laid out, how the VPS and Docker stack run, how to work and ship a ticket, and then, step by step, the integrations still to switch on: media and video storage, Razorpay, email, SMS, analytics and off-site backups.

## Scene 2: Where to start reading (0:45–1:45)

**On screen:** in the editor, open in turn: `README.md`, `GLOSSARY.md`, `docs/adr/` (nine ADRs), `AGENTS.md`, `CLAUDE.md`, `docker/README.md`.

**Say:**

> Start with the README. It's long on purpose: it holds the architecture, every module, the ticket board, the migration rules, the deploy runbook and the list of owner blockers. `GLOSSARY.md` defines the domain words. Use them in code and PRs. There are nine ADRs; the ones that matter most day to day are 0001 on deploys, 0007 on the append-only audit log and 0008 on the outbox. `AGENTS.md` warns that this is Next.js 16.4, which differs from older versions, and its docs ship in `node_modules/next/dist/docs`. And `docker/README.md` is the VPS runbook. The spec itself is GitHub issue 55, and the original FOA brief, with a line-by-line check against the closed tickets, is in `docs/handover/spec-check.md`.

## Scene 3: The architecture (1:45–3:30)

**On screen:** the Mermaid diagram from README "Deploy and infrastructure", rendered on GitHub. Point at each box as it's named.

**Say:**

> The system is split in two. The web app is one Next.js app on Vercel, pinned to the Mumbai region, `bom1`, serving `friendsofanimals.dev`. Everything with state lives on one VPS: Hostinger, Mumbai, Fedora 44, run from a git clone at `/srv/foa`. On that VPS, Postgres 18 holds the data. The app reaches it only through PgBouncer on port 6432, with TLS and SCRAM passwords. A background worker connects to Postgres directly and does everything slow: sending messages, scanning uploads for malware, refunds, ledger postings and scheduled jobs. ClamAV and Gotenberg run beside it. Caddy is the TLS edge for two self-hosted tools: Umami for cookieless analytics and GlitchTip for error tracking. GitHub Actions runs CI, an uptime probe and the production deploy. The deploy is run by hand. The rule that ties it together: Vercel never runs background work. The app writes an outbox row in the same transaction as the change, and the worker picks it up.

## Scene 4: The VPS and Docker, live (3:30–5:00)

**On screen:** SSH to the VPS. Run:

```sh
cd /srv/foa/docker && ls *.yml
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
systemctl list-timers --all | grep -i foa
ls /etc/foa/secrets/
```

**Say:**

> Here's the VPS. There are five Compose projects, all run from `/srv/foa/docker`. `compose.yml` is the database stack: `foa-pg-prod`, `foa-pg-nonprod` and `foa-pgbouncer`. `workers.yml` has `worker-prod` with the ClamAV and Gotenberg sidecars, plus `worker-media`, which is opt-in behind the `media` profile and not running yet. `analytics.yml` is Umami, `edge.yml` is Caddy on the host network, and `errors.yml` is GlitchTip with its own Postgres. Host timers handle pgBackRest backups, a monthly restore drill into a throwaway container, and certificate renewal for PgBouncer. Secrets live in `/etc/foa/secrets`, root-only, mode 0600. One warning: always name the service when you start workers, as in `up -d worker-prod`. A bare `up -d` on `workers.yml` would also build and start the dormant staging and preview workers. Every container logs to journald, which keeps logs for a year.

## Scene 5: The codebase (5:00–7:00)

**On screen:** the editor's file tree. Expand `src/app`, `src/server` (foundations), `src/server/modules` (about 48 folders), then open one use case and its `policy.ts`. Show `src/server/app.ts` and `src/server/ports/`.

**Say:**

> In the code, `src/app` holds the routes: public pages, `/dashboard` and `/participant` for families, `/institution` for schools, `/judge`, `/organisation` for NGOs, and `/admin` for staff. Under `src/server` are the foundations: identity, access, audit, outbox, ports, crypto and the database schema. Next to them are about forty-eight domain modules, one per area: competitions, registration, entries, judging, certificates, donations, ledger, auctions and so on. Every read or write goes through one entry point: `as(actor).useCase(input)`. Each use case first calls `authorize`, which checks the actor's role grants in the database with `can()`, and the second factor for staff. Then it validates input with Zod and writes inside one transaction, together with its audit row and its outbox events. All of them commit together or none do. Outside services sit behind ports: email, SMS, storage, the malware scanner, the payment gateway and media. Each port has a contract test that both the real adapter and its fake must pass. Personal data columns are encrypted with AES-GCM, with a blind index beside them for lookups.

## Scene 6: Database, migrations and backups (7:00–8:15)

**On screen:** `ls drizzle | tail`, then README "Rule F2", then `docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa info`.

**Say:**

> The schema is Drizzle with real SQL migrations in `drizzle/`. Main now has 170 of them, through `0169`. Production had 68 applied at the last check, so the next production deploy will apply about a hundred at once. Treat that as a planned rollout, not a routine push. Three rules. Never edit a migration that has been applied. Rule F2: a new enum value ships in its own deploy before any code uses it, and the README has a helper to check this against production's applied count. And production migrates inside the deploy job, through `PROD_DIRECT_URL`. Backups use pgBackRest: a weekly full, daily differentials and continuous WAL archiving, so point-in-time restore works, and the monthly drill proves it. But the backup repo is on the same disk as the database. Until off-site backups exist, losing this VPS loses everything. That's the top operations item later in this video.

## Scene 7: Local setup and tests (8:15–9:45)

**On screen:** run the local setup from the Appendix. Sign in as `super-admin@example.test` using the capture mailbox. Then run `pnpm check`. Show the Actions tab with a green "CI gate".

**Say:**

> Local runs need no outside accounts. Email and SMS go to a capture mailbox, payments use a built-in test checkout, and uploads go to your disk. Start Postgres with `docker compose up -d db`, then migrate, seed and run `pnpm dev`. You sign in with a one-time code, which you read from the capture mailbox. Seeded staff already have an authenticator, and its secret is in `src/server/seed/second-factor.ts`. For tests, Vitest runs use cases on an in-process Postgres called PGlite, with the real migrations and a fake clock. That's about six hundred files and the main safety net. There are also real-Postgres race tests and about a hundred Playwright journeys with axe accessibility checks. Before you push, run `pnpm check`. CI's one required check is "CI gate". Add the `full-ci` label before you merge so the end-to-end jobs run.

## Scene 8: Shipping a ticket and deploying (9:45–11:00)

**On screen:** README "The loop" (12 steps), then the `deploy-production.yml` workflow page, then README's 9-step deploy table.

**Say:**

> To work a ticket: create a worktree from `foa/main`. The only git remote is called `foa`. Write the tests first, run the full check, open a PR, and write `Closes` only if the PR finishes the ticket. Main is protected: PRs only, merge commits only, and CI must be green on an up-to-date branch. Merging doesn't deploy. Production goes out only through the "Deploy production" workflow, run by hand. It builds on GitHub, runs migrations, uploads a prebuilt deployment, smoke-tests it, then promotes it to the domain. Two cautions from experience. First, a red run at the final check may already be live, so check the deployment tag. Second, the worker is deployed separately on the VPS. Deploy Vercel first, because Vercel applies the migrations, then rebuild `worker-prod` from the same commit.

## Scene 9: Proof the spec is done (11:00–11:45)

**On screen:** run:

```sh
gh issue list --state open
gh issue list --state closed --limit 500 --json number --jq length
gh issue view 55 --json state,closedAt
```

Then scroll the README ticket board (M0–M8) and `docs/handover/spec-check.md`.

**Say:**

> There are no open issues. All 122 issues are closed. The spec, issue 55, was closed by PR 288, and its 80 build tickets, numbers 56 to 135, are all closed as completed. Eight of them were closed by hand, each with a comment listing its PRs. We also checked the original brief against the closed tickets. Every role, module, entity and workflow is covered. Four were done more simply on purpose: courier tracking numbers are typed in by hand, social posts are exported and posted by hand, Umami is separate from the internal reports, and vets are a directory service rather than a listing type. Any of those could be a new ticket.

## Scene 10: Remaining integrations (11:45–16:00)

**On screen:** README "Owner-only blockers and the HR register". For each item, show the README section, then the matching Vercel env page or VPS file path. **Never show secret values on screen.**

### 10a. Media and video storage: Cloudflare R2 + worker-media (HR-13, HR-35)

**Say:**

> First, media storage, which covers artwork photos, scans and videos. The code uses Cloudflare R2 through the S3 API. Browsers upload straight to R2 with presigned URLs, so files never pass through Vercel. The worker scans every file with ClamAV. Then worker-media makes the derivatives. For images that's upright, resized copies with location data stripped. For videos, ffmpeg makes an H.264 MP4 of at most 1080p plus a poster frame. Originals are never served. Video limits are MP4, MOV, 3GP or WebM, up to 200 MB and three minutes. To switch it on, FOA creates the R2 account: a private bucket, its `-public` twin on a custom domain, and scoped tokens. On Vercel, set the four `R2_` variables and `PUBLIC_ASSET_BASE_URL`. On the VPS, write the same four lines into `/etc/foa/secrets/worker_prod_r2.env` and recreate worker-prod, so scans work. Then write a read-write token into `worker_media_r2.env` and start worker-media with the `media` profile. Until worker-media runs, no entry can go live, because nothing makes the derivatives.

```sh
cd /srv/foa/docker && WORKER_VERSION=$(git -C /srv/foa rev-parse --short HEAD) \
  docker compose -f workers.yml --profile media up -d --build --wait worker-media foa-gotenberg
```

### 10b. Razorpay: fees, donations, monthly giving, auctions (HR-15)

**Say:**

> Second, Razorpay. One gateway port covers school bulk fees, individual fees, refunds, one-time donations, monthly donations and auction payments. In production only `rzp_live_` keys are accepted. Anything else means every payment is refused. FOA must finish NGO KYC, including the signatory's video KYC. Then set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` on Vercel, and point a webhook at `/api/webhooks/razorpay` for the payment, order and refund events listed in the README. Every signal is re-checked against Razorpay's own record, and replayed webhooks change nothing. Two code tasks remain here. First, the worker sends refunds, so it needs the same keys, but `workers.yml` has no env file for them yet. That's a small PR adding something like `worker_prod_razorpay.env`. Second, monthly giving uses Razorpay subscriptions, and the code knows the `subscription` events. Before you enable it, confirm which subscription events the webhook must send, because the README list covers payments, orders and refunds only. Features stay off until staff turn on `donations.enabled`, `donations.recurringEnabled` and `auctions.enabled` in `/admin/settings`.

### 10c. Email: Amazon SES (HR-12)

**Say:**

> Third, email, and this is the critical path. Sign-in is by email code, so until SES production access is approved nobody can sign in, not even staff. AWS denied the first request. The support case number is in the README, with the reply to send. After approval, make a narrowed key limited to sending, then set the `SES_` variables and `SES_PRODUCTION_ACCESS=true` on Vercel. The cancellation email also needs an SES configuration set. Then bootstrap the first super admin with `pnpm admin:bootstrap-super-admin`, grant other roles at `/admin/roles`, and have FOA enter its real facts.

### 10d. SMS: MSG91 with DLT (HR-14)

**Say:**

> Fourth, SMS. Indian rules require DLT registration of the sender and every template, done through MSG91. Then set the three `MSG91_` variables on Vercel, and a super admin turns on `sms.enabled`. Until then everything goes by email and the in-app inbox.

### 10e. Analytics: Umami (HR-52)

**Say:**

> Fifth, analytics. Umami already runs at `stats.friendsofanimals.dev`. The site just doesn't send to it, because `UMAMI_ORIGIN` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID` are missing on Vercel. While you're in Vercel settings, fix `APP_URL`. It still points at the old `vercel.app` host, which breaks canonical links, the sitemap and robots.txt.

### 10f. Off-site copies: Backblaze B2 and pgBackRest repo2 (HR-25)

**Say:**

> Sixth, off-site copies. The nightly copy of R2 files to Backblaze B2 is built, but it needs a B2 bucket, a scoped key and a read-only R2 token. Database backups need a second pgBackRest repository off the box. There's no ticket for it yet. Please make one first, because it's the biggest risk in the system today.

### 10g. Rebuild the production worker

**Say:**

> Finally, the production worker runs code from the 22nd of November. It's also missing the field-encryption keys, its R2 file, `APP_URL` and the Razorpay keys. After you deploy main to Vercel, write those env files and rebuild worker-prod from the same commit. Until then, newer message types queue and wait.

```sh
cd /srv/foa && git pull --ff-only && cd docker
WORKER_VERSION=$(git -C /srv/foa rev-parse --short HEAD) \
  docker compose -f workers.yml up -d --build --wait worker-prod
curl -s https://friendsofanimals.dev/api/health/worker
```

## Scene 11: Operations hardening (16:00–16:45)

**On screen:** README "Operations" (7 items) and "Production issues found".

**Say:**

> A few operations items. Nothing alerts today when a backup, restore drill or certificate renewal fails, so add alerts. GitHub's scheduled uptime check runs far less often than its five-minute schedule, so add an external monitor. PgBouncer is open to the internet. It's protected by TLS, SCRAM and CrowdSec, but there's no IP allowlist. An allowlist needs Vercel static IPs and a way for the deploy job to reach port 6432. Rotate the database passwords that earlier sessions handled. Run `vercel logout` on the VPS. Change the GlitchTip admin password and turn on two-factor for Umami. And make offline copies of the field keys and the pgBackRest passphrase, because losing them loses data for good.

## Scene 12: Known code gaps and cleanup (16:45–17:30)

**On screen:** README "Code gaps", "Dormant preview machinery", "Old names and leftover accounts". Then open `https://friendsofanimals.dev/gallery` to show the 500 page.

**Say:**

> The README lists the known code gaps honestly. There's no idempotency key on email and SMS sends, so a crash at the wrong moment can send twice. There's no payment reconciliation sweep. Retention runs in dry-run mode until the lawyer confirms the periods. Some use cases have no page yet. There's also dormant machinery from the old per-PR preview design, and old `shipped-it.dev` names to clean up. One thing we saw today: on the live site, `/gallery` and `/verify` return a 500. Production predates the last 43 tickets, so deploying main is the likely fix. Confirm it after the deploy.

## Scene 13: If you want the app on the VPS too (17:30–18:00)

**On screen:** the top of `Dockerfile` (targets `runner`, `migrate`, `worker`, `worker-media`) and the root `docker-compose.yml`.

**Say:**

> Today the web app runs on Vercel and everything else runs on the VPS in Docker. If you'd rather host the app on the VPS too, the Dockerfile already has a `runner` target, a standalone Next.js server, plus a `migrate` target. The root compose file runs both locally. Moving production would mean a Caddy site for the domain, running migrations on the VPS instead of in GitHub Actions, and replacing the Vercel deploy workflow. That's a project in its own right, so give it a ticket and an ADR. Thanks for taking this on. The README is your map, and the HR register is your to-do list.

---

## Appendix: recording setup

**Local practice copy** (for scenes 4–7 of the management video and scene 7 here). From README "Local setup":

```sh
cd /root/friends-of-animals            # or a fresh clone
pnpm install
docker compose up -d db                # Postgres 18 on 127.0.0.1:5432
cp .env.example .env
echo "CAPTURE_MAILBOX_TOKEN=$(openssl rand -hex 32)" >> .env.local
pnpm db:migrate
pnpm db:seed                           # fake accounts and data, local only
pnpm dev                               # http://localhost:3000
pnpm worker:dev                        # second terminal: background jobs
```

- **Sign in:** use `super-admin@example.test` (also `member1`, `member2`, `member3`). Read the code with:
  `curl -s http://localhost:3000/api/capture-mailbox -H "x-capture-mailbox-token: $CAPTURE_MAILBOX_TOKEN" -H "x-capture-mailbox-to: super-admin@example.test"`
- **Second factor:** add the secret from `src/server/seed/second-factor.ts` to any authenticator app.
- **Payments:** the test checkout dialog lets you choose pay or decline. No money moves.
- **Uploads:** stored on disk. Clean them by draining once: `curl -X POST http://localhost:3000/api/preview/drain -H "x-capture-mailbox-token: $CAPTURE_MAILBOX_TOKEN"`. Image derivatives aren't produced locally (that needs worker-media), so pick screens that don't depend on them.
- **Feature switches:** some areas (auctions, monthly donations, clubs, surveys, invitations) default to off. Turn them on at `/admin/settings` as the super admin before recording.
- **Empty screens:** the seed covers accounts, roles, competitions, judging, consent, institutions, registrations, payments, refunds, guardians and children, the ledger, notifications, the CMS and posts. For the gallery, auctions, directory and adoption, create one or two records through their admin screens first.
- **Never record:** real secrets, `/etc/foa/secrets` file contents, or Vercel env values.
