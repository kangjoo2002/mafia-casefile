# Setup

## 사전 요구사항
- Docker Engine 또는 Docker Desktop
- Docker Compose v2

## Docker Compose 실행 명령
```bash
docker compose up -d
```

## PostgreSQL 접속 정보
- Host: `localhost`
- Port: `5432`
- Database: `mafia_casefile`
- User: `mafia`
- Password: `mafia_password`

## Redis 접속 정보
- Host: `localhost`
- Port: `6379`

## 상태 확인 명령
```bash
docker compose ps
docker exec mafia-casefile-postgres pg_isready -U mafia -d mafia_casefile
docker exec mafia-casefile-redis redis-cli ping
```

## 종료 명령
```bash
docker compose down
```

## volume 삭제 명령
```bash
docker compose down -v
```
