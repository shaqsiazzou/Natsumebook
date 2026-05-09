#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p logs

if [[ -f .admin.pid ]] && kill -0 "$(cat .admin.pid)" 2>/dev/null; then
  echo "Natsumebook is already running: http://0.0.0.0:7000/"
  echo "Admin: http://0.0.0.0:7000/admin"
  exit 0
fi

HOST=0.0.0.0 PORT=7000 nohup setsid node server.mjs > logs/admin.log 2>&1 < /dev/null &
echo "$!" > .admin.pid

echo "Natsumebook started: http://0.0.0.0:7000/"
echo "Admin: http://0.0.0.0:7000/admin"
echo "PID: $(cat .admin.pid)"
echo "Log: logs/admin.log"
