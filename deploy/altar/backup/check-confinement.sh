#!/usr/bin/env bash
# Prove the backup account on the Nocix machine can do nothing but SFTP inside its own
# directory. Run on the gib tenant after any sshd change there:
#   ssh gib-altar '~/app/backup/check-confinement.sh'
# Exits non-zero if the account can get a shell, see outside its chroot, or forward.
set -uo pipefail
export DOCKER_CONTEXT=rootless
# shellcheck source=restic-run.sh
. "$(dirname "$0")/restic-run.sh"

readonly TARGET="gibshowbackup@142.54.172.186"
readonly CLIENT_KEY="/root/.ssh/id_ed25519"
readonly CLIENT_HOSTS="/root/.ssh/known_hosts"

# The restic image carries OpenSSH, so the same client restic uses runs the checks.
client() {
  local tool="$1"
  shift
  docker run --rm -i \
    -v "$BACKUP/backup_key:$CLIENT_KEY:ro" \
    -v "$BACKUP/known_hosts:$CLIENT_HOSTS:ro" \
    --entrypoint "$tool" "$RESTIC_IMAGE" -o BatchMode=yes -o UpdateHostKeys=no "$@"
}

failures=0
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

echo "1. a command must not run"
output="$(client ssh "$TARGET" 'echo SHELL-OPEN' 2>&1)"
echo "$output" | grep -q 'SHELL-OPEN' && fail "the account ran a command"
echo "   -> $(echo "$output" | head -1)"

echo "2. SFTP must see only its own tree"
listing="$(printf 'ls -1 /\ncd /etc\n' | client sftp -b - "$TARGET" 2>&1)"
echo "$listing" | sed 's/^/   /' | head -6
echo "$listing" | grep -qE '^(bin|etc|home|root|usr)$' && fail "the chroot shows system directories"
echo "$listing" | grep -q 'gib-show' || fail "its own directory is missing"

echo "3. port forwarding must be refused"
# `-W` opens a forwarded channel at once, so the server answers immediately. A plain
# `-L` forward is only checked when something connects through it.
forward="$(timeout 20 docker run --rm -i \
  -v "$BACKUP/backup_key:$CLIENT_KEY:ro" -v "$BACKUP/known_hosts:$CLIENT_HOSTS:ro" \
  --entrypoint ssh "$RESTIC_IMAGE" -o BatchMode=yes -o UpdateHostKeys=no \
  -W 127.0.0.1:22 "$TARGET" </dev/null 2>&1)"
echo "   -> $(echo "$forward" | head -1)"
# The server must refuse the forward itself. Matching a generic word like "failed"
# would also match unrelated client warnings and pass for the wrong reason.
echo "$forward" | grep -qiE 'administratively prohibited|forwarding.*(disabled|refused)|port forwarding failed|only sftp' ||
  fail "forwarding was not refused by the server"

[ "$failures" -eq 0 ] && echo "confinement: all checks passed" || echo "confinement: $failures check(s) failed"
exit "$failures"
