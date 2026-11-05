# restic settings for gib.show's off-box backups. References only, no values.
# deploy.sh renders this with `op inject` into ~/app/backup/restic-environment
# (mode 600) on the gib tenant.
#
# The path is inside gibshowbackup's chroot on the Nocix machine: /gib-show there is
# /srv/backups/gib-show on disk.
RESTIC_REPOSITORY=sftp:gibshowbackup@142.54.172.186:/gib-show/restic
RESTIC_PASSWORD={{ op://valve/gib-show app/restic_password }}
