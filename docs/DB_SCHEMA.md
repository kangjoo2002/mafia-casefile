# DB Schema

## 현재 DB 범위

현재 애플리케이션은 PostgreSQL에 `users` 테이블과 `game_event_logs` 테이블을 사용한다. 인증, 세션, 기타 도메인 테이블은 아직 추가하지 않는다.

## users 테이블

- `id`: 문자열 기본키, `cuid()` 기본값
- `email`: 사용자 이메일, 고유값
- `nickname`: 표시 이름
- `passwordHash`: 비밀번호 해시
- `createdAt`: 생성 시각, `now()` 기본값
- `updatedAt`: 수정 시각, 변경 시 자동 갱신

## game_event_logs 테이블

- `game_event_logs`는 게임 중 의미 있는 행동이 확정되었을 때 남기는 영구 사건 기록이다.
- Redis나 Socket.IO 이벤트가 아니라 PostgreSQL에 저장되는 타임라인 기준 데이터다.
- `gameId + seq`가 사건 정렬과 중복 방지의 기준이다.

필드:

- `id`: 문자열 기본키, `cuid()` 기본값
- `gameId`: 게임 식별자
- `seq`: 게임 내부 순번
- `type`: 사건 타입
- `turn`: 사건이 발생한 턴
- `phase`: 사건 발생 당시 phase 문자열
- `actorUserId`: 사건 발생 주체 사용자 ID, nullable
- `payload`: JSON payload
- `visibilityDuringGame`: 게임 중 공개 범위
- `visibilityAfterGame`: 게임 종료 후 공개 범위
- `requestId`: command와 연결되는 요청 ID, nullable
- `createdAt`: 생성 시각, `now()` 기본값

제약 조건:

- `gameId + seq`는 unique다.
- `gameId + requestId`, `gameId + type`, `gameId + createdAt` index가 있다.

`visibilityDuringGame`과 `visibilityAfterGame`은 각각 게임 진행 중과 게임 종료 후 공개 범위를 구분한다.

## DATABASE_URL 예시

```bash
DATABASE_URL="postgresql://mafia:mafia_password@localhost:5432/mafia_casefile"
```

## Migration 실행 명령

```bash
pnpm --filter api prisma:migrate:dev -- --name init_user
```

GameEventLog 추가 마이그레이션은 이후 `add_game_event_logs` 이름으로 생성한다.

## Seed 실행 명령

```bash
pnpm --filter api prisma:seed
```
