# Shared by backup.sh and restore-test.sh: run restic against the off-box repository.
#
# The repository is restic over SFTP to the Nocix machine (142.54.172.186), as the
# account gibshowbackup, which can only speak SFTP inside /srv/backups/gib-show there
# (bridge-routing: ansible/playbooks/60-backup-target.yml).
#
# Files, all written by deploy.sh, all mode 600, none printed:
#   ~/app/backup/restic-environment  RESTIC_REPOSITORY and RESTIC_PASSWORD (op inject)
#   ~/app/backup/backup_key          the SSH key (1Password: backup_ssh_private_key)
#   ~/app/backup/known_hosts         Nocix's host key, checked against the deploy connection
# restic runs in a throwaway container; its cache lives in the gib_restic-cache volume.

readonly APP="$HOME/app"
readonly BACKUP="$APP/backup"
readonly RESTIC_IMAGE="restic/restic:0.18.1"

restic_run() {
  docker run --rm -i \
    --memory 1g --cpus 1 \
    --env-file "$BACKUP/restic-environment" \
    -e RESTIC_CACHE_DIR=/cache \
    -v "$BACKUP/backup_key:/root/.ssh/id_ed25519:ro" \
    -v "$BACKUP/known_hosts:/root/.ssh/known_hosts:ro" \
    -v gib_restic-cache:/cache \
    "$RESTIC_IMAGE" \
    -o "sftp.args=-o UpdateHostKeys=no -o BatchMode=yes" \
    "$@"
}
# UpdateHostKeys=no: known_hosts is mounted read-only (it holds the one verified key),
# so OpenSSH's attempt to add the server's other key types would only log a warning.
