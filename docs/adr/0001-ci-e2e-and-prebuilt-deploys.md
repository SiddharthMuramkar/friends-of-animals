---
Status: accepted
---

# CI runs the E2E journeys on `next start`; production deploys are prebuilt

Vercel builds nothing. Git deployments are off (`vercel.json`
`git.deploymentEnabled: false`, plus the project's `createDeployments:
disabled`), so there are no preview deployments and no staging environment on
Vercel. GitHub Actions does all the checking: `.github/workflows/ci.yml` runs
lint, typecheck, format, Vitest, a test-integrity scan, a build with no
database, the migration checks, and the Playwright journeys with axe against
`next start` and a Postgres service on the runner (`APP_ENV=local`, the capture
mailbox on a per-run token, every provider on its fake or capture adapter).
Every job feeds one required check, "CI gate". Production deploys come only
from `.github/workflows/deploy-production.yml`: `vercel build --prod` on the
runner (which migrates the production database first), then
`vercel deploy --prebuilt --skip-domain`, a smoke check of the unaliased URL,
and `vercel promote`. We chose this over E2E against each PR's Vercel preview
(the old `e2e.yml`) because every preview build spends Vercel build minutes
and a deployment from the plan's small budget, needs its own database, and
makes CI wait on Vercel. A runner-local server gives the same journeys at no
Vercel cost, with no bypass secret.

## Considered Options

- E2E on per-PR Vercel previews, triggered by `repository_dispatch`: rejected,
  as above.
- A staging environment on Vercel: rejected for the same cost, and because
  `next start` with `APP_ENV=local` already exercises the production build.
- Git-triggered production builds on Vercel: rejected. A prebuilt deploy
  costs no build minutes, runs only commits already on main, and lets the
  workflow check migrations and smoke the deployment before it takes the
  domains.

## Consequences

- `deploy-production.yml` refuses a commit that isn't on main, records it in
  the deployment's `githubCommitSha` meta, and fails if the applied migrations
  don't match the journal.
- The journeys must pass against a local build. What only production shows
  (robots, the sitemap link, www → apex, no sample content) is checked by the
  read-only `prod-smoke` Playwright project, run by hand through `e2e.yml`
  against the live site.
- To fit GitHub's concurrent-job limit, E2E and the real-Postgres suite run on
  main, by hand, and on PRs from `train/` or `revert/` branches or labelled
  `full-ci`. "CI gate" accepts them as skipped only on other PRs.
