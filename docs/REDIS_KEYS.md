# Redis Keys

## 현재 key prefix 규칙

현재 Redis key는 기본적으로 `mafia-casefile` prefix를 사용한다.

형식:

```text
mafia-casefile:{key}
```

예:

```text
mafia-casefile:test:read-write
```

## 환경변수

- `REDIS_URL`: Redis 연결 문자열. 기본값은 `redis://localhost:6379`
- `REDIS_KEY_PREFIX`: Redis key prefix. 기본값은 `mafia-casefile`

## 테스트 key 예시

테스트에서는 충돌을 피하기 위해 `randomUUID()`를 포함한 key를 사용한다.

예:

```text
test:550e8400-e29b-41d4-a716-446655440000:plain
```

실제 저장 시에는 위 key가 `mafia-casefile:` prefix와 결합된다.

## 향후 예정 key 목록

- `game:{gameId}:session`
- `lock:game:{gameId}`
- `idem:game:{gameId}`
- `chat:game:{gameId}:recent`
- `connection:user:{userId}`
- `room:{roomId}:game`

## 주의

Redis는 진행 중 게임 상태와 임시 상태 저장에 사용한다. 영구 사건 기록은 Redis가 아니라 PostgreSQL `GameEventLog`를 기준으로 한다.
