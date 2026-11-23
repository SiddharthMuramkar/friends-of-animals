# Your to-do list for M0 (owner only)

Written 2026-11-21 from live GitHub, Vercel (CLI, names only) and this VPS. Steps are in the order to do them. Each one says what it unblocks. **Never paste a secret value into a chat, issue, PR or agent session.** Type or pipe it straight into Vercel or GitHub.

Where the spec and live state disagree, live wins. The differences are marked **Live ≠ spec**.

---

## 1. Lift the GitHub Actions billing lock (5 min)

**Live ≠ spec:** spec §1.4 assumes CI runs. In fact every CI run on this repo (main, M0, #138, #139) fails without starting: *"The job was not started because your account is locked due to a billing issue."*

- github.com → your avatar → **Settings → Billing and licensing** → fix the payment problem shown there. The repo is public, so Actions minutes are free once the lock is lifted.
- Re-run the M0 check: `gh run rerun 44861353598 --repo siddhartxts/friends-of-animals`
- Check: `gh run list --repo siddhartxts/friends-of-animals --limit 3` shows runs that actually ran.
- **Unblocks:** the `Lint, typecheck, format, Vitest` check on #136, #138, #139 and every ticket PR, and `e2e.yml` (preview E2E).

## 2. Merge PR #139 into main (new account names)

- https://github.com/siddhartxts/friends-of-animals/pull/139 → **Merge pull request** → **Create a merge commit** (main's history uses merge commits) → **Confirm**.
  CLI: `gh pr merge 139 --repo siddhartxts/friends-of-animals --merge`
- Expected: Vercel builds `main` and fails at `pnpm db:migrate` (no database yet). That's harmless. Note that main currently builds as **Production** (see step 5).
- **Unblocks:** `tests/e2e/vercel-bypass.ts` sends the bypass secret to `*-bitacu1.vercel.app` previews. On M0 it still only accepts `acme-ef4b`, so preview E2E would hit the Vercel login wall. The preview-DB sweeper also starts looking up PRs in the new repo.

## 3. Merge PR #138 into main (e2e capture token = HR-02)

- #138 is a draft: open https://github.com/siddhartxts/friends-of-animals/pull/138 → **Ready for review** → **Merge pull request** → **Create a merge commit**.
  CLI: `gh pr ready 138 --repo siddhartxts/friends-of-animals && gh pr merge 138 --repo siddhartxts/friends-of-animals --merge`
- It's already in M0 (442dd99). Merging it into **main** is what counts, because `e2e.yml` runs from main only.
- **Live ≠ PR body:** the body says the `CAPTURE_MAILBOX_TOKEN` secret "is set in GitHub and Vercel". That was the old repo. In the new repo and team it isn't set yet (step 6).
- **Unblocks:** preview E2E gets the token, so the 57b sign-in journey and later journeys (59b, 63c) can read codes from the capture mailbox.

## 4. Merge main into M0

I checked with `git merge-tree`: the merge is clean. Only `docker/README.md` changed on both sides, and it auto-merges.

- Clicks: https://github.com/siddhartxts/friends-of-animals/compare/M0...main → **Create pull request**, titled `Merge main (#138, #139) into M0` → **Merge pull request** → **Create a merge commit**.
- Or, from a terminal on the VPS (uses a throwaway worktree, so no agent's checkout is touched):
  ```sh
  cd /root/friends-of-animals && git fetch foa
  git worktree add --detach /tmp/m0-merge foa/M0 && cd /tmp/m0-merge
  git merge --no-ff foa/main -m "Merge main (#138 e2e token, #139 new accounts) into M0"
  git push foa HEAD:M0
  cd /root/friends-of-animals && git worktree remove /tmp/m0-merge
  ```
- Then tell t11, so foa-57 runs `git merge foa/M0` on `ticket/57-harness` before opening its PR.
- **Unblocks:** ticket branches cut from M0 get the bitacu1 host check and the new repo name.

## 5. Fix the Vercel environments (team bitacu1, project friends-of-animals)

**Live ≠ spec:** spec §1.1 says `main` deploys the custom environment `staging` at `shipped-it.dev`, and Production tracks a dormant `production` branch. On the new project:
- there are **zero custom environments**;
- the production branch is **`main`**;
- the only domain is `friends-of-animals-green.vercel.app`;
- the only env var is `APP_ENV` (Preview and Production).

`shipped-it.dev` still resolves to Vercel, probably to the old `acme-ef4b` project.

- Vercel → bitacu1 → friends-of-animals → **Settings → Environments → Create Environment**: name `staging`, Branch Tracking "branch is" `main`.
- **Settings → Environments → Production** → Branch Tracking → change `main` to `production`. That branch doesn't exist, so production stays dormant. Pushing it later would migrate pg-prod.
- Old project (team acme-ef4b) → Settings → Domains → remove `shipped-it.dev`. Then on the new project → **Settings → Domains → Add** `shipped-it.dev` and assign it to `staging` (Vercel may ask for a TXT record in Cloudflare).
- **Settings → Environment Variables**:
  - `staging`: `APP_ENV` = `staging`, `APP_URL` = `https://shipped-it.dev`
  - Preview: confirm `APP_ENV` = `preview`
  - Production: confirm `APP_ENV` = `production`
- Note: the Pro trial ends about 2026-12-04. Custom environments and `bom1` functions need Pro.
- **Unblocks:** the "staging" targets in step 6 and staging deploys from main. HR-27 checks later run on staging.

## 6. HR-01: auth secret and capture token (D0-3)

Make each value in your own terminal and pipe it straight in, so it never shows on screen:

```sh
P=friends-of-animals; S=bitacu1
printf %s "$(openssl rand -base64 48)" | vercel env add BETTER_AUTH_SECRET --environment preview    --sensitive -p $P --scope $S
printf %s "$(openssl rand -base64 48)" | vercel env add BETTER_AUTH_SECRET --environment production --sensitive -p $P --scope $S
T=$(openssl rand -hex 32)      # same value into Vercel Preview and the GitHub secret, never printed
printf %s "$T" | vercel env add CAPTURE_MAILBOX_TOKEN --environment preview --sensitive -p $P --scope $S
printf %s "$T" | gh secret set CAPTURE_MAILBOX_TOKEN --repo siddhartxts/friends-of-animals
unset T
```
If `vercel env add … --environment preview` asks for a Git branch, press Enter (all preview branches).

- For **staging**, use the dashboard (Settings → Environment Variables → Add, environment `staging`, Sensitive on). Add a third fresh `BETTER_AUTH_SECRET` and a separate `CAPTURE_MAILBOX_TOKEN` (`openssl rand -hex 32`).
- All three `BETTER_AUTH_SECRET` values must differ. The GitHub secret must equal the **Preview** mailbox token (the `T=` lines do that).
- Check (names only):
  - `vercel --scope bitacu1 env list --project friends-of-animals` shows `BETTER_AUTH_SECRET` ×3 and `CAPTURE_MAILBOX_TOKEN` ×2;
  - `gh secret list --repo siddhartxts/friends-of-animals` shows `CAPTURE_MAILBOX_TOKEN` and `VERCEL_AUTOMATION_BYPASS_SECRET`;
  - also confirm the latter matches Vercel → Settings → Deployment Protection → Protection Bypass for Automation of the **new** project.
- **Unblocks:** preview deployments boot with Better Auth (57b), and the preview E2E gate can pass instead of staying `deferred`.

## 7. Bring the Postgres/PgBouncer stack back (needed before any Vercel build passes)

Every Vercel build runs `pnpm db:migrate` first and fails with `DIRECT_URL is not set`. What's on this VPS today:
- `db.shipped-it.dev` resolves here (189.72.156.29);
- it's a fresh Fedora 44 box: 8 CPU, 31 GB RAM, 396 GB free;
- there is **no Docker** (only podman), no `/srv/foa` and no `/etc/foa`;
- firewalld is running.

The agents may not run docker, so these steps are yours.

1. **Install Docker Engine and the compose plugin.** The scripts call `docker exec`, `docker compose --wait` and the `DOCKER-USER` chain, so podman won't do.
   ```sh
   dnf -y install dnf-plugins-core
   dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo
   dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin && systemctl enable --now docker
   ```
   If Docker's repo has no Fedora 44 build yet, use Fedora's `moby-engine` and `docker-compose` packages instead.
2. **Firewall.**
   - Open 80/tcp for the Let's Encrypt HTTP-01 challenge: `firewall-cmd --permanent --add-service=http && firewall-cmd --reload`.
   - If the Hostinger panel firewall is on, allow 22 (first), 80 and 6432.
   - After bring-up, run `scripts/docker-user-fw.sh show`. That script was written on the old box's iptables Docker, so confirm the `FOA-INBOUND` chain really exists here.
3. **Bring-up**, from `docker/README.md` "Bring-up on a fresh VPS" (clone after step 2, so the URL is the new repo):
   ```sh
   git clone https://github.com/siddhartxts/friends-of-animals.git /srv/foa && cd /srv/foa/docker
   scripts/bootstrap-secrets.sh && scripts/install-cert.sh
   docker compose -f compose.yml up -d --build --wait
   docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa stanza-create
   docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa check
   scripts/cert-renew.sh && scripts/install-systemd.sh && scripts/install-crowdsec.sh
   systemctl start foa-pgbackrest-full.service && scripts/smoke-test.sh
   ```
   **Skip the README's `scripts/restore-drill.sh` until M0 reaches main.** The copy on main is the old drill that writes into pg-prod. The safe rewrite (#67) is only on M0.
4. **Data.** Starting empty is fine: staging and production only ever held migration 0000 (`pg_trgm`). If the old VPS still exists, its pgBackRest repo1 is the only copy of whatever was there, so decide before deleting it.
5. **Vercel database URLs.** Copy the values from `/etc/foa/vercel-urls.env` into Vercel as `DATABASE_URL` and `DIRECT_URL`:
   - `PREVIEW_*` → Preview
   - `STAGING_*` → staging
   - `PROD_*` → Production

   Then redeploy the latest M0 preview (Deployments → ⋯ → Redeploy).
   Check: the `Vercel` status on #136 turns green.
6. **Same session, recommended:**
   - HR-03: put a read-only fine-grained PAT in `/etc/foa/sweeper.env` as `GITHUB_TOKEN=…` (file mode 0600).
   - HR-04: Vercel → Settings → Build and Deployment → On-Demand Concurrent Builds → "Run up to one build per branch".
- **Unblocks:** every preview build (the `Vercel` status), preview databases `foa_pr_<n>`, the 57b preview seed, and with steps 3 and 6 the Seam 2 journeys on previews.

## 8. HR-19: accept or change the M0 defaults

These ship as code or settings defaults. Changing one later means a follow-up ticket; nothing waits on your answer. Reply "HR-19 accepted" or list your changes to t11, or as a comment on #57.

| Default | Value | Used by |
|---|---|---|
| Sign-in code | 6 digits, valid 10 min, 5 wrong tries per code | 57b (being built now) |
| Code request limits | 5 per email and 20 per IP, per 15 min (20 leaves room for Playwright) | 57b, 58 |
| Session length | member 30 days, staff 12 hours | 60, 62 |
| Step-up window | a fresh second factor is valid for 10 min | 60 |
| Lost second factor | **no default in the spec:** who resets a staff member's factor, and how they prove who they are | 60 |
| Org flags | `org.has80G` off, `org.fcraEnabled` off, `sms.enabled` off | 62, 58 |
| CSP rollout | Report-Only on staging for N days, then enforce. **N is open: pick a number** | 65 |

## 9. HR-20: M0 legal copy (counsel and FOA leadership)

You need approved text for:
- the privacy notice;
- the terms;
- the messages-consent document;
- the sign-up notice.

The drafts in the repo are `src/content/legal/privacy.ts` and `terms.ts`. #64 seeds them as the first published consent versions, and 57b shows the sign-up notice. Hand the approved text to the agent as a file or comment.

**Unblocks:** production only (the placeholder guard fails a production build until real copy is in). Merges into M0 don't wait for it.

## 10. The rest of M0's residue, in the order it's needed

- **Repo settings (D0-11).** Live: `delete_branch_on_merge` is false and there are 0 rulesets.
  - Settings → General → tick "Automatically delete head branches".
  - Settings → Rules → Rulesets: on `main`, require a PR and block force-push and deletion; on `production`, restrict creation, updates and deletion.
- **Optional (D0-2):** approve Vercel MCP team access for bitacu1. It returns 403 today; the CLI works, so this isn't urgent.
- **HR-05**, before #58's preview journey: `FIELD_ENCRYPTION_KEYS`, `FIELD_HMAC_KEY` and `PII_HASH_KEY` for Preview and staging. Keep an offline backup: a lost key means lost phone numbers. Wait for #58's PR to state the key format.
- **HR-06**, before 63c: non-production R2 buckets with prefixes `staging/` and `pr-<n>/`, a bucket-scoped token, and CORS `PUT` from `https://friends-of-animals-*-bitacu1.vercel.app` and `https://shipped-it.dev`. **Live ≠ spec:** the spec still says `acme-ef4b`.
- **HR-07**, when 61b merges: apply the agent-written SQL for the worker roles, put the worker secrets in `/etc/foa/secrets`, run `docker compose -f docker/workers.yml up -d`, and check that `worker-preview` attaches to a new `foa_pr_<n>` and lets go after the sweep.
- **HR-08**, when 63b merges: start the ClamAV sidecar (about 1–1.5 GB RAM; the box has 31 GB) and install the `preview-dropped.d` purge hook.
- **HR-22, HR-23, HR-24**, when 66a merges:
  - Sentry org, projects and DSNs (staging, Production, workers);
  - an uptime provider checking `/api/health`, TCP `db.shipped-it.dev:6432` and the worker heartbeat, plus one forced alert;
  - 365-day log storage (a Vercel drain plus the VPS container logs).
- **HR-25**, when #68 merges: a B2 account, bucket and bucket-scoped key, a retention window (30 days proposed), and pgBackRest repo2. **HR-26**, once M0 is on main: `git -C /srv/foa pull && sudo /srv/foa/docker/scripts/install-systemd.sh` (restore-drill timer).
- **HR-28** before you merge #136 (real iPhone, iOS 16.0–16.3, font scaling, Lighthouse ×3), then **HR-27** after it merges: no CSP violations on staging, the journeys pass on staging, and the forced Sentry and uptime alerts fire.
- **HR-29** hygiene:
  - DB passwords are fresh on the new box (`bootstrap-secrets.sh`);
  - decide when to `vercel logout` here (agents use this CLI today);
  - the Hostinger disk-encryption question;
  - Vercel Static IPs.
- **HR-30**, counsel rulings under DPDP: parental-consent method, own login from age 13, school as joint fiduciary, minors' public credit, data residency (R2, and B2 has no India region), audit retention vs erasure, 365-day IP logs.
- **HR-21**, for FOA: the real facts that replace the `SITE.org` placeholders (email, phone, address, socials, grievance contact).
- **HR-60**, only if 57a picks template seeding: refresh `foa_seed` on pg-nonprod.
- **Long lead: start these today with FOA (D0-14).** Send FOA leadership the provider request pack (`git show 8d06f2e:docs/foa/provider-setup-request.md`). It covers:
  - HR-11: domain on Vercel and Cloudflare;
  - HR-12: SES `ap-south-1`;
  - HR-13: R2 production account;
  - HR-14: DLT and MSG91;
  - HR-15: Razorpay KYC;
  - HR-16: 12A/80G;
  - HR-17: named staff (super admins, finance approvers, safeguarding lead, grievance officer);
  - HR-18 at go-live: `pnpm admin:bootstrap-super-admin` against production.
- **Not needed in hc mode:** D0-5/D0-6/D0-7 (cloud Orchestrator environments and session parameters). D0-1 is done: #137 is in main and main is in M0. D0-8: keep #136 as the M0 milestone PR.
