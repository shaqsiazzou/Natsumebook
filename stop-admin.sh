#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .admin.pid ]]; then
  echo "Natsumebook admin is not running."
  exit 0
fi

pid="$(cat .admin.pid)"

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  echo "Natsumebook admin stopped."
else
  echo "Natsumebook admin process was not running."
fi

rm -f .admin.pid
