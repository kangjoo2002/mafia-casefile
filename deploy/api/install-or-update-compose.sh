#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/mafia-api}"
COMPOSE_SOURCE="${COMPOSE_SOURCE:-/tmp/docker-compose.yml}"
GHCR_OWNER="${GHCR_OWNER:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
API_CONTAINER_NAME="${API_CONTAINER_NAME:-}"
API_PORT="${API_PORT:-3001}"
RUN_MIGRATION="${RUN_MIGRATION:-false}"
GHCR_READ_USERNAME="${GHCR_READ_USERNAME:-}"
GHCR_READ_TOKEN="${GHCR_READ_TOKEN:-}"

mkdir -p "$DEPLOY_DIR"

compose_target="$DEPLOY_DIR/docker-compose.yml"
env_target="$DEPLOY_DIR/.env"

for required in GHCR_OWNER IMAGE_TAG API_CONTAINER_NAME GHCR_READ_USERNAME GHCR_READ_TOKEN; do
  if [ -z "${!required}" ]; then
    echo "$required is required"
    exit 1
  fi
done

if [ ! -f "$COMPOSE_SOURCE" ]; then
  echo "compose source not found"
  exit 1
fi

install -m 0644 "$COMPOSE_SOURCE" "$compose_target"

if [ ! -f "$env_target" ]; then
  cat > "$env_target" <<EOF
GHCR_OWNER=${GHCR_OWNER}
IMAGE_TAG=${IMAGE_TAG}

API_CONTAINER_NAME=${API_CONTAINER_NAME}
API_PORT=${API_PORT}

NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://mafia:mafia_password@<infra-private-ip>:5432/mafia_casefile
REDIS_URL=redis://<infra-private-ip>:6379
REDIS_KEY_PREFIX=mafia-casefile-prod

JWT_SECRET=change-me-after-infra-ready

GAME_SESSION_TTL_SECONDS=86400
CONNECTION_STATE_TTL_SECONDS=86400
REQUEST_IDEMPOTENCY_TTL_SECONDS=86400

GAME_COMMAND_LOCK_TTL_MS=5000
GAME_COMMAND_LOCK_WAIT_MS=1000
GAME_COMMAND_LOCK_RETRY_MS=50

CHAT_CACHE_LIMIT=50
CHAT_CACHE_TTL_SECONDS=86400

SOCKET_IO_REDIS_ADAPTER_ENABLED=false
EOF
  echo "infra env placeholders are not configured yet"
  exit 1
fi

upsert_kv() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) print key "=" value
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

get_value() {
  local key="$1"
  grep -E "^${key}=" "$env_target" | tail -n1 | cut -d= -f2-
}

upsert_kv "GHCR_OWNER" "$GHCR_OWNER" "$env_target"
upsert_kv "IMAGE_TAG" "$IMAGE_TAG" "$env_target"
upsert_kv "API_CONTAINER_NAME" "$API_CONTAINER_NAME" "$env_target"
upsert_kv "API_PORT" "$API_PORT" "$env_target"

database_url="$(get_value DATABASE_URL)"
redis_url="$(get_value REDIS_URL)"
jwt_secret="$(get_value JWT_SECRET)"

if [[ "$database_url" == *"<infra-private-ip>"* ]] || [[ "$redis_url" == *"<infra-private-ip>"* ]] || [[ "$jwt_secret" == "change-me-after-infra-ready" ]]; then
  echo "infra env placeholders are not configured yet"
  exit 1
fi

if [ -z "$GHCR_READ_USERNAME" ] || [ -z "$GHCR_READ_TOKEN" ]; then
  echo "GHCR credentials are required"
  exit 1
fi

printf '%s\n' "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_READ_USERNAME" --password-stdin >/dev/null

image_ref="ghcr.io/${GHCR_OWNER}/mafia-casefile-api:${IMAGE_TAG}"

if [ "$RUN_MIGRATION" = "true" ]; then
  docker pull "$image_ref"
  docker run --rm --env-file "$env_target" "$image_ref" pnpm prisma:migrate:deploy
fi

cd "$DEPLOY_DIR"
docker compose pull
docker compose up -d

show_recent_logs() {
  docker compose logs --tail=100 api || true
}

trap 'show_recent_logs' ERR

echo "Waiting for API health..."
for i in {1..30}; do
  if curl -fsS "http://localhost:${API_PORT:-3001}/health" > /dev/null; then
    echo "API is healthy"
    trap - ERR
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "API health check failed"
show_recent_logs
exit 1
