#!/usr/bin/env bash
# Off-box backup of both gib.show databases, every 72 hours. Runs on the box as `gib`,
# from the user-level timer gib-backup.timer. Installed by deploy.sh; never edited by hand.
#
# pg_dump and pg_restore are called by version, matching the server ($PG_MAJOR, set by
# the official image): the image also carries Postgres 18 client tools (pulled in by
# postgresql-contrib), and an 18 dump writes settings a 16 server rejects on restore
# ("unrecognized configuration parameter transaction_timeout").
#
# For each environment: pg_dump (custom format) runs inside that environment's own
# Postgres container and streams straight into restic, which runs in a throwaway
# container and writes to the Nocix machine over SFTP (see restic-run.sh). Nothing is
# staged on /srv/gib, so a full disk cannot fail a backup. Restic deduplicates, so
# image bytes that did not change are stored once.
set -euo pipefail
export DOCKER_CONTEXT=rootless
# shellcheck source=restic-run.sh
. "$(dirname "$0")/restic-run.sh"

cd "$APP"
for environment in production staging; do
  echo "backup: $environment started $(date -u +%FT%TZ)"
  docker compose exec -T "postgres-$environment" \
    sh -c '"/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump" --username gibassets --format custom --compress 0 gibassets' |
    restic_run backup --stdin --stdin-filename "$environment.dump" --tag "$environment" --host altar-prod
  echo "backup: $environment finished $(date -u +%FT%TZ)"
done

# Keep 7 daily, 4 weekly and 6 monthly snapshots per environment.
restic_run forget --prune --group-by tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6
restic_run check --read-data-subset 2%
echo "backup: done $(date -u +%FT%TZ)"
