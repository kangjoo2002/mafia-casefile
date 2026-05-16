# Game Session

## 목적

진행 중인 게임 상태를 한 덩어리로 다루기 위한 추상화다. WebSocket command 처리와 재접속 복구는 이 상태를 기준으로 동작한다.

## 현재 모델

- `gameId`
- `roomId`
- `phase`
- `turn`
- `version`
- `hostUserId`
- `players`
- `votes`
- `nightActions`
- `phaseEndsAt`
- `processedRequests`
- `createdAt`
- `updatedAt`

`players`에는 `userId`, `nickname`, `role`, `status`, `connectionStatus`, `lastSeenAt`이 들어간다.

## 저장소 인터페이스

- `GameSessionRepository.save(session)`
- `GameSessionRepository.findByGameId(gameId)`

현재 운영 경로는 `RedisGameSessionRepository`를 사용한다.
`InMemoryGameSessionRepository`는 테스트/개발 보조 구현으로 남겨둔다.
Redis key는 `game-session:{gameId}`다.
저장값은 JSON이며, Date 필드는 조회 시 다시 `Date` 객체로 복원된다.
TTL은 `GAME_SESSION_TTL_SECONDS`를 사용하고 기본값은 86400초다.
Redis lock, requestId idempotency 강화, 접속 상태 Redis 저장, reconnect 복구는 아직 별도 작업이다.
접속 상태는 별도로 `connection:user:{userId}` / `connection:socket:{socketId}` key에 저장한다.
