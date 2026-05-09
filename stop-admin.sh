#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .admin.pid ]]; then
  echo "Nazumi admin is not running."
  exit 0
fi

pid="$(cat .admin.pid)"

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  echo "Nazumi admin stopped."
else
  echo "Nazumi admin process was not running."
fi

rm -f .admin.pid
