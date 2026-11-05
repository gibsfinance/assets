#!/usr/bin/env bash
# Nightly off-box backup of both gib.show databases. Runs on the box as `gib`, from
# the user-level timer gib-backup.timer. Installed by deploy.sh; never edited by hand.
#
# For each environment: pg_dump (custom format) runs inside that environment's own
# Postgres container and streams straight into restic, which runs in a throwaway
# container and writes to the Hetzner Storage Box over SFTP. Nothing is staged on
# /srv/gib, so a full disk cannot fail a backup and the dump never touches this disk.
# Restic deduplicates, so image bytes that did not change are stored once.
#
# Secrets come from ~/app/backup/restic.env (mode 600, written by deploy.sh from
# 1Password) and the SSH key ~/app/backup/storagebox_key. Neither is printed.
set -euo pipefail
export DOCKER_CONTEXT=rootless

readonly APP="$HOME/app"
readonly BACKUP="$APP/backup"
readonly RESTIC_IMAGE="restic/restic:0.18.1"

restic_run() {
  docker run --rm -i \
    --memory 1g --cpus 1 \
    --env-file "$BACKUP/restic.env" \
    -e RESTIC_CACHE_DIR=/cache \
    -v "$BACKUP/storagebox_key:/root/.ssh/id_ed25519:ro" \
    -v "$BACKUP/known_hosts:/root/.ssh/known_hosts:ro" \
    -v gib_restic-cache:/cache \
    "$RESTIC_IMAGE" "$@"
}

cd "$APP"
for environment in production staging; do
  echo "backup: $environment started $(date -u +%FT%TZ)"
  docker compose exec -T "postgres-$environment" \
    pg_dump --username gibassets --format custom --compress 0 gibassets |
    restic_run backup --stdin --stdin-filename "$environment.dump" --tag "$environment" --host altar-prod
  echo "backup: $environment finished $(date -u +%FT%TZ)"
done

# Keep 7 daily, 4 weekly and 6 monthly snapshots per environment.
restic_run forget --prune --group-by tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6
restic_run check --read-data-subset 2%
echo "backup: done $(date -u +%FT%TZ)"
