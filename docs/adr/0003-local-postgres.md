# ADR-0003: Local Postgres uses the rescue database on port 5432

- Status: Accepted
- Date: 2026-11-17

## Context

Day-to-day development connects the app on the host to a Postgres the developer starts separately. The connection string has to match in the compose file and in `.env.example`, or migrate and the dev server look at different databases.

Evidence: `docker-compose.yml`, `.env.example`, `README.md`.

## Decision

The local database is Postgres database `rescue`, user `rescue`, password `rescue`, on port 5432.

`docker-compose.yml` publishes that port as `5432:5432`. That binds every network interface of the machine, not only loopback (`127.0.0.1`). The comment in the file says this is so the app on the host can use `localhost:5432`. The development password is the one in the repo. It is not a production password.

`.env.example` uses `postgres://rescue:rescue@localhost:5432/rescue`. Inside Compose, the app container is pointed at host `db` instead, by the compose file, not by `.env.example`.

Tests do not use this server. They use PGlite (ADR-0001).

## Consequences

- Cloud agents and laptops that need `npm run db:migrate` or `npm run db:seed` use this same URL. Those two scripts read `DATABASE_URL` from the process environment. They do not load the `.env` file. `.cursor/cloud-start.sh` starts a Postgres from the distro packages (Docker is not installed on the default Cursor VM image) and creates this login from `.env.example`.
- Do not describe the published compose port as loopback-only. It is not.
- The password in git is for local development only. Production credentials stay out of the repo.
