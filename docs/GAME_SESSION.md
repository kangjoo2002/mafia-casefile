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

초기 구현은 `InMemoryGameSessionRepository`다. 후속 작업에서 Redis 저장소로 교체한다.
