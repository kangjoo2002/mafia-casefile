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

현재 운영 경로는 `InMemoryGameSessionRepository`를 사용한다.
Redis용 `RedisGameSessionRepository`도 추가되어 있으며, key는 `game-session:{gameId}`이고 저장값은 JSON이다.
Date 필드는 조회 시 다시 `Date` 객체로 복원된다.
TTL은 아직 적용하지 않는다.
기본 저장소 전환은 다음 작업에서 진행한다.
