# PgBouncer for the VPS: Debian trixie-slim plus PgBouncer from PGDG.
#
# There is no upstream PgBouncer image (Docker Hub's pgbouncer/pgbouncer is a
# third-party build and lags), so install PGDG's package. 1.26.1 fixes the 2026
# pre-auth CVEs and CVE-2026-107350; keep it patched.
#
# The PGDG signing key is copied from the pinned official postgres image, which
# already trusts it, so nothing is fetched over the network unverified.
FROM debian:trixie-20261104-slim

ARG PGBOUNCER_VERSION=1.26.1-1.pgdg13+1

COPY --from=postgres:18.7-trixie /usr/local/share/keyrings/postgres.gpg.asc /usr/share/keyrings/pgdg.asc

# Fixed uid/gid 6432: the TLS key on the host (/etc/foa/pgbouncer-tls) and the
# auth file (/etc/foa/secrets/pgbouncer_userlist.txt) are owned by it.
RUN set -eux; \
    groupadd --system --gid 6432 pgbouncer; \
    useradd --system --uid 6432 --gid 6432 --home-dir /nonexistent --no-create-home \
        --shell /usr/sbin/nologin pgbouncer; \
    echo 'deb [signed-by=/usr/share/keyrings/pgdg.asc] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main' \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    # ca-certificates: with client TLS on, PgBouncer loads the default CA
    # bundle (/etc/ssl/certs/ca-certificates.crt) even though client
    # certificates are not used, and refuses to start without it.
    apt-get install -y --no-install-recommends "pgbouncer=${PGBOUNCER_VERSION}" ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    rm -f /etc/pgbouncer/userlist.txt; \
    pgbouncer --version

USER 6432:6432
EXPOSE 6432
# SIGINT is PgBouncer's safe shutdown (PAUSE + SHUTDOWN): in-flight
# transactions finish first. SIGTERM waits for every client to disconnect.
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/sbin/pgbouncer"]
CMD ["/etc/pgbouncer/pgbouncer.ini"]
