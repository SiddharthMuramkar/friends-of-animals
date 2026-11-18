# Postgres for the VPS (pg-prod, pg-nonprod and the restore drill).
#
# The official image plus pgBackRest from PGDG. The base image installs
# ca-certificates only to fetch gosu and then purges it, and pgbackrest does
# not depend on it, so install it here too: TLS to an object store (the R2
# repo2 added later) fails without it. pgBackRest must be >= 2.59.3 (the
# weak-subkey advisory for encrypted repositories); Debian's own 2.55 is too
# old, so the PGDG version is pinned.
FROM postgres:18.7-trixie

ARG PGBACKREST_VERSION=2.60.1-1.pgdg13+1

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        "pgbackrest=${PGBACKREST_VERSION}" \
        ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    install -d -o postgres -g postgres -m 0750 \
        /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest; \
    install -d -o postgres -g postgres -m 0755 /etc/pgbackrest/conf.d; \
    rm -f /etc/pgbackrest.conf; \
    pgbackrest version
