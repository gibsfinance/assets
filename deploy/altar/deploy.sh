#!/usr/bin/env bash
# Deploy gib.show to the altar-prod `gib` tenant. Run from the workstation.
#
#   deploy/altar/deploy.sh                 # both environments
#   deploy/altar/deploy.sh staging         # one environment (its four services)
#
# Steps:
#   1. check out each environment's branch on the box (master -> production,
#      staging -> staging) under /srv/gib/src/<environment>;
#   2. render gib.env.tpl with `op inject` straight into ~/app/.env (mode 600);
#   3. copy compose.yml to ~/app;
#   4. build the images one at a time (the tenant's memory is capped; parallel
#      builds alongside running collectors could exhaust it), then `up -d`;
#   5. wait for every container to report healthy.
#
# Needs: the 1Password desktop session (op inject runs here, never on the box) and
# an SSH route to the tenant. GIB_SSH names the host (default gib-altar); set
# GIB_SSH_OPTIONS for extra ssh options, e.g. "-F /path/to/ssh_config".
# The full runbook is docs/deploy-altar.md.
set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HOST="${GIB_SSH:-gib-altar}"
readonly REPOSITORY="https://github.com/gibsfinance/assets.git"
read -r -a SSH_OPTIONS <<<"${GIB_SSH_OPTIONS:-}"

# The `+` form expands to nothing for an empty array: macOS's Bash 3.2 otherwise
# treats "${SSH_OPTIONS[@]}" as unbound under `set -u` when GIB_SSH_OPTIONS is unset.
remote() { ssh ${SSH_OPTIONS[@]+"${SSH_OPTIONS[@]}"} "$HOST" "$@"; }

branch_for() {
  case "$1" in
    production) echo master ;;
    staging) echo staging ;;
    *) echo "unknown environment: $1" >&2; return 1 ;;
  esac
}

environments=("$@")
[ ${#environments[@]} -gt 0 ] || environments=(production staging)

echo "==> sources"
for environment in "${environments[@]}"; do
  branch="$(branch_for "$environment")"
  remote "set -e
    dir=/srv/gib/src/$environment
    [ -d \"\$dir/.git\" ] || git clone --quiet $REPOSITORY \"\$dir\"
    git -C \"\$dir\" fetch --quiet origin $branch
    git -C \"\$dir\" checkout --quiet --detach FETCH_HEAD
    echo \"$environment: \$(git -C \"\$dir\" log -1 --format='%h %s')\""
done

echo "==> secrets (op inject -> ~/app/.env)"
op inject -i "$HERE/gib.env.tpl" |
  remote 'umask 077; mkdir -p ~/app; cat > ~/app/.env.new && mv ~/app/.env.new ~/app/.env'
# Proof without contents: mode, owner, size, line count.
remote 'stat -c "%a %U %s bytes" ~/app/.env; grep -c = ~/app/.env | sed "s/$/ lines/"'

echo "==> compose file"
remote 'mkdir -p ~/app && cat > ~/app/compose.yml.new && mv ~/app/compose.yml.new ~/app/compose.yml' \
  <"$HERE/compose.yml"

# The tunnel serves both environments, so every deploy (re)starts it.
services=(tunnel)
for environment in "${environments[@]}"; do
  services+=("postgres-$environment" "browser-$environment" "server-$environment" "collector-$environment")
done

echo "==> build and start: ${services[*]}"
remote "set -e
  cd ~/app
  export DOCKER_CONTEXT=rootless
  # Compose builds through buildx bake, which refuses to read a build context outside
  # the project directory (~/app) unless told to. The contexts are our own checkouts
  # under /srv/gib/src, so the check adds nothing here.
  export BUILDX_BAKE_ENTITLEMENTS_FS=0
  for service in ${services[*]}; do
    case \"\$service\" in browser-*|tunnel) docker compose pull --quiet \"\$service\" ;; *) docker compose build --quiet \"\$service\" ;; esac
  done
  docker compose up -d --remove-orphans ${services[*]}"

echo "==> waiting for health"
remote "cd ~/app
  export DOCKER_CONTEXT=rootless
  for attempt in \$(seq 1 60); do
    unhealthy=\$(docker compose ps --format '{{.Service}} {{.Health}}' ${services[*]} | grep -v ' healthy\$' || true)
    [ -z \"\$unhealthy\" ] && { docker compose ps --format 'table {{.Service}}\t{{.Status}}'; exit 0; }
    sleep 10
  done
  echo 'not healthy after 10 minutes:'; echo \"\$unhealthy\"; exit 1"
