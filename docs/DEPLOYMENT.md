# Deployment

## 개요

현재 API 서버만 배포 준비가 완료되어 있고, `mafia-infra-1`은 아직 미완성이다.
따라서 API 서버의 `/opt/mafia-api/.env`는 infra 연결값이 placeholder 상태일 수 있으며, 이 상태에서 자동 deploy가 실패하는 것은 정상이다.

배포는 다음 순서로 진행한다.

1. GitHub Actions가 API Docker image를 GHCR에 push한다.
2. GitHub Actions가 `mafia-api-1`, `mafia-api-2`에 SSH 접속해 `/opt/mafia-api` 기준으로 자동 배포한다.
3. infra가 준비된 뒤 각 API 서버의 `.env`에서 실제 DB/Redis/JWT 값을 넣는다.

## API 서버 최초 셋업

각 서버에는 repository를 clone하지 않는다. SSH로 직접 접속해서 Docker와 배포 디렉터리만 준비한다.

### mafia-api-1

```bash
ssh mafia-api-1
sudo apt update
sudo apt install -y ca-certificates curl netcat-openbsd
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo mkdir -p /opt/mafia-api
sudo chown -R ubuntu:ubuntu /opt/mafia-api
docker version
docker compose version
```

### mafia-api-2

```bash
ssh mafia-api-2
sudo apt update
sudo apt install -y ca-certificates curl netcat-openbsd
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo mkdir -p /opt/mafia-api
sudo chown -R ubuntu:ubuntu /opt/mafia-api
docker version
docker compose version
```

## 서버 파일

각 API 서버에는 아래 두 파일만 둔다.

```text
/opt/mafia-api/docker-compose.yml
/opt/mafia-api/.env
```

repo의 `deploy/api/docker-compose.yml`을 서버에 반영하고, `.env`는 서버별로 관리한다.

## infra 준비 후 수정할 값

`mafia-infra-1`이 준비된 뒤 각 API 서버의 `.env`에서 다음 값을 실제 값으로 바꾼다.

```env
DATABASE_URL=postgresql://mafia:mafia_password@<actual-infra-private-ip>:5432/mafia_casefile
REDIS_URL=redis://<actual-infra-private-ip>:6379
JWT_SECRET=<actual-secret>
```

연결 확인은 infra 준비 후에 수행한다.

```bash
nc -vz <actual-infra-private-ip> 5432
nc -vz <actual-infra-private-ip> 6379
```

## GHCR 로그인

서버에서 GHCR 읽기 전용 로그인에 사용하는 PAT는 `read:packages` 권한만 있으면 된다.

```bash
echo "<GHCR_PAT>" | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
```

## GitHub Secrets

자동 배포에 필요한 GitHub Secrets는 다음이다.

```text
OCI_API_1_HOST
OCI_API_2_HOST
OCI_API_SSH_USER
OCI_API_SSH_PRIVATE_KEY
GHCR_READ_USERNAME
GHCR_READ_TOKEN
```

## CI/CD flow

1. `main`에 push되면 GitHub Actions가 `pnpm install`, `pnpm --filter api prisma:generate`, `pnpm --filter api lint`, `pnpm --filter api build`를 실행한다.
2. 테스트가 통과하면 API Docker image를 빌드해 GHCR에 `sha-<github-sha>`와 `latest` 태그로 push한다.
3. GitHub Actions가 `deploy/api/docker-compose.yml`과 `deploy/api/install-or-update-compose.sh`를 SSH로 서버에 올린 뒤 `mafia-api-1`의 `/opt/mafia-api`를 갱신하고 배포한다.
4. `mafia-api-1` 배포가 성공한 뒤 `mafia-api-2`에 같은 절차를 수행한다.
5. infra placeholder가 남아 있으면 배포는 `infra env placeholders are not configured yet` 메시지로 중단된다.

## Rollback

이전 image로 되돌릴 때는 각 API 서버에서 `IMAGE_TAG`만 이전 SHA로 바꾸고 다시 배포한다.

```bash
cd /opt/mafia-api
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=sha-<previous-sha>/' .env
docker compose pull
docker compose up -d
curl http://localhost:3001/health
```
