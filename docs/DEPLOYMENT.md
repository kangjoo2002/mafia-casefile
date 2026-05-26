# Deployment

## 배포 단계

### Step 1. API Docker image CI

- GitHub Actions에서 API image를 build/push한다.
- GHCR에 `ghcr.io/<OWNER>/mafia-casefile-api:<tag>` 형식으로 image를 저장한다.

### Step 2. Manual API deploy

- `mafia-api-1`, `mafia-api-2` 서버에서 `docker compose pull/up`으로 API container를 실행한다.
- `deploy/api/deploy-api.sh`로 수동 배포한다.

### Step 3. Automatic SSH CD

- GitHub Actions에서 SSH로 `mafia-api-1`, `mafia-api-2`에 접속한다.
- 서버에서 `docker compose pull/up`을 자동 실행한다.
- 이번 작업 범위가 아니며 다음 단계에서 추가한다.

## Infra layout

```text
mafia-api-1     1 OCPU / 6GB
mafia-api-2     1 OCPU / 6GB
mafia-infra-1   2 OCPU / 12GB
```

```text
mafia-api-1:
- NestJS API
- Socket.IO Gateway
- Docker container로 실행

mafia-api-2:
- NestJS API
- Socket.IO Gateway
- Docker container로 실행

mafia-infra-1:
- PostgreSQL
- Redis
- Prometheus/Grafana later
```

## API server first setup

서버에서 최초 1회 실행한다.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

재접속 후 Docker 설치를 확인한다.

```bash
docker version
docker compose version
```

## GHCR login on server

서버에서 GHCR에 로그인한다.

```bash
echo "<GHCR_PAT>" | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
```

PAT 권한은 다음만 필요하다.

```text
read:packages
```

## Deploy files

서버에서 배포 파일을 둘 디렉터리를 만든다.

```bash
mkdir -p ~/mafia-casefile/deploy/api
```

repo의 `deploy/api` 파일을 서버에 복사하거나 git clone 후 해당 디렉터리를 사용한다.

## api-1 .env example

```env
GHCR_OWNER=<github-owner>
IMAGE_TAG=latest
API_CONTAINER_NAME=mafia-api-1
API_PORT=3001
DATABASE_URL=postgresql://mafia:mafia_password@<infra-private-ip>:5432/mafia_casefile
REDIS_URL=redis://<infra-private-ip>:6379
JWT_SECRET=<secret>
```

## api-2 .env example

```env
GHCR_OWNER=<github-owner>
IMAGE_TAG=latest
API_CONTAINER_NAME=mafia-api-2
API_PORT=3001
DATABASE_URL=postgresql://mafia:mafia_password@<infra-private-ip>:5432/mafia_casefile
REDIS_URL=redis://<infra-private-ip>:6379
JWT_SECRET=<secret>
```

## Manual deploy

```bash
cd ~/mafia-casefile/deploy/api
./deploy-api.sh
```

## Health check

```bash
curl http://localhost:3001/health
docker compose ps
docker compose logs -f api
```

## Notes

- API 서버 두 대는 같은 Docker image를 사용한다.
- 서버별 차이는 `.env`로만 관리한다.
- PostgreSQL/Redis에는 infra private IP로 접근한다.
- DB/Redis public port는 외부에 열지 않는다.
- GitHub Actions에서 SSH로 서버에 접속하는 자동 배포는 다음 단계에서 추가한다.
