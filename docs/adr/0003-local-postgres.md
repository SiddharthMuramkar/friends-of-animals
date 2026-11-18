# ADR-0003: Local Postgres uses the rescue database on port 5432

- Status: Accepted
- Date: 2026-11-18

## Context

Day-to-day development connects the app on the host to a Postgres the developer starts separately. The connection string has to match in the compose file and in `.env.example`, or migrate and the dev server look at different databases.

Docker's published ports skip the host firewall (`ufw`). Publishing `5432:5432` put the local database, and the password that is already in the repo, on the public internet of the VPS.

Evidence: `docker-compose.yml`, `.env.example`, pull request #20.

## Decision

The local database is Postgres database `rescue`, user `rescue`, password `rescue`, on port 5432.

Compose publishes that port on loopback only: `127.0.0.1:5432:5432`. The app container's port is the same way: `127.0.0.1:3000:3000`. On the machine itself, `localhost:5432` still works. From another machine, open an SSH tunnel:

```bash
ssh -L 5432:127.0.0.1:5432 <host>
```

Then use `localhost:5432` on your own computer. Do not publish `5432:5432` or `3000:3000` without the `127.0.0.1:` prefix.

`.env.example` uses `postgres://rescue:rescue@localhost:5432/rescue`. Inside Compose, the app container is pointed at host `db` instead, by the compose file, not by `.env.example`.

Tests do not use this server. They use PGlite (ADR-0001).

## Consequences

- Cloud agents and laptops that need `npm run db:migrate` or `npm run db:seed` use this same URL. Those two scripts read `DATABASE_URL` from the process environment. They do not load the `.env` file. `.cursor/cloud-start.sh` starts a Postgres from the distro packages (Docker is not installed on the default Cursor VM image) and creates this login from `.env.example`. That server listens on `127.0.0.1` as well.
- The password in git is for local development only. Production credentials stay out of the repo. Loopback binding is what keeps this password off the public internet.
