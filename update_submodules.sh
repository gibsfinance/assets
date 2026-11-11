#!/bin/sh
# Refreshes the vendored artwork repositories: shallow, and only the directories the
# collectors read. The list of repositories lives in
# packages/server/src/submodule-refresh.ts, which the collector also runs itself at the
# start of every run (REFRESH_SUBMODULES=true), so calling this by hand is rarely needed.
# Kept so an existing deploy command that calls it keeps working.
set -e

cd "$(dirname "$0")"
if [ ! -f scripts/refresh-submodules.mjs ]; then
  cd /usr/src/app
fi

exec node scripts/refresh-submodules.mjs "${SUBMODULES_DIRECTORY:-submodules}"
