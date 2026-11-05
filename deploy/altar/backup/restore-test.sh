#!/usr/bin/env bash
# Weekly proof that the backups restore. Runs on the box as `gib`, from the
# user-level timer gib-restore-test.timer.
#
# For each environment: restore the newest snapshot into a throwaway Postgres
# container (same image as production, its own memory limit, no ports, removed
# afterwards), then compare the row count of every table with the live database.
# Tables written since the snapshot can only have grown, so the restored count
# must be at least 95% of the live one and never zero where live is not.
# Any mismatch exits non-zero, which marks the systemd unit failed.
set -euo pipefail
export DOCKER_CONTEXT=rootless

readonly APP="$HOME/app"
readonly BACKUP="$APP/backup"
readonly RESTIC_IMAGE="restic/restic:0.18.1"
readonly SCRATCH="gib-restore-test"

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

# Row counts as "table count" lines, one per table in the public schema.
count_rows() {
  "$@" psql --username gibassets --dbname gibassets -At -F ' ' -c "
    select format('%s %s', table_name,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text)
    from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
}

cleanup() { docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cd "$APP"
status=0
for environment in production staging; do
  cleanup
  docker run -d --name "$SCRATCH" --memory 2g --cpus 1 \
    -e POSTGRES_USER=gibassets -e POSTGRES_DB=gibassets -e POSTGRES_HOST_AUTH_METHOD=trust \
    "gib/postgres:$environment" >/dev/null
  until docker exec "$SCRATCH" pg_isready -U gibassets -d gibassets >/dev/null 2>&1; do sleep 2; done

  restic_run dump --tag "$environment" latest "/$environment.dump" |
    docker exec -i "$SCRATCH" pg_restore --username gibassets --dbname gibassets --no-owner --exit-on-error

  live="$(count_rows docker compose exec -T "postgres-$environment")"
  restored="$(count_rows docker exec "$SCRATCH")"
  if ! join <(echo "$live") <(echo "$restored") | awk -v env="$environment" '
      { live = $2; restored = $3
        if (live > 0 && (restored == 0 || restored < live * 0.95)) { printf "restore-test: %s %s live=%s restored=%s\n", env, $1, live, restored; bad = 1 } }
      END { exit bad }'; then
    status=1
  fi
  echo "restore-test: $environment checked $(echo "$restored" | wc -l) tables $(date -u +%FT%TZ)"
done
exit "$status"
