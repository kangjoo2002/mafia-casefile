#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and fill values."
  exit 1
fi

set -a
source .env
set +a

docker compose pull
docker compose up -d

echo "Waiting for API health..."
for i in {1..30}; do
  if curl -fsS "http://localhost:${API_PORT:-3001}/health" > /dev/null; then
    echo "API is healthy"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "API health check failed"
docker compose logs --tail=100 api
exit 1
