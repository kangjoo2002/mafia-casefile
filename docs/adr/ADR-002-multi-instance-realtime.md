# ADR-002. 멀티 인스턴스 실시간 상태 공유와 이벤트 전달

## Status

Accepted

## Context

Mafia Casefile은 Socket.IO 기반 실시간 게임 서버다. 운영 환경에서 API 서버가 2대 이상이면 사용자는 서로 다른 API 인스턴스에 연결될 수 있다.

초기 `RoomsService`는 room 상태를 process-local `Map`에 저장했다. 또한 Socket.IO는 기본 in-memory adapter를 사용한다.

## Evidence

다음 characterization test는 process-local 저장소와 기본 Socket.IO adapter의 멀티 인스턴스 한계를 재현한다.

- `apps/api/src/rooms/rooms.multi-instance.spec.ts`
  - process-local room 저장소는 다른 `RoomsService` 인스턴스와 room을 공유하지 않는다.
- `apps/api/src/realtime/realtime.multi-instance.spec.ts`
  - 기본 Socket.IO adapter는 한 서버 인스턴스에서 broadcast한 이벤트를 다른 서버 인스턴스에 연결된 socket으로 전달하지 않는다.
  - Redis Socket.IO adapter를 적용하면 다른 서버 인스턴스에 연결된 socket도 같은 room broadcast를 수신한다.
- `apps/api/src/rooms/redis-room.repository.spec.ts`
  - Redis room 저장소는 room을 Redis key에 저장하고 목록 index를 유지한다.
  - 다른 `RedisRoomRepository` 인스턴스에서도 저장된 room을 조회할 수 있다.

검증 명령:

```bash
pnpm --filter api test:multi-instance
pnpm --filter api test:room-redis
pnpm --filter api test:socket-redis-adapter
```

## Decision

멀티 인스턴스 운영을 지원하기 위해 다음 방향을 선택한다.

1. Room 상태를 process-local `Map`에서 Redis 기반 저장소로 옮긴다. 이 결정은 `RedisRoomRepository`로 적용한다.
2. Socket.IO Redis Adapter를 적용해 room broadcast와 개인 이벤트를 인스턴스 간 전달한다. 이 결정은 `RedisIoAdapter`로 적용한다.
3. 자동 phase timer는 process-local `setTimeout`만으로 운영하지 않고 Redis/worker 기반 만료 처리로 이전한다.
4. Redis snapshot과 PostgreSQL `GameEventLog`를 조합해 재접속 복구와 이벤트 보정을 수행한다.

## Consequences

- API 인스턴스가 여러 대여도 같은 room 상태를 조회하고 갱신할 수 있다.
- 서로 다른 API 인스턴스에 연결된 사용자가 같은 room 이벤트를 받을 수 있다.
- Redis 장애, replica lag, lock 안정성, Pub/Sub 유실 가능성은 별도 설계와 테스트가 필요하다.
- 영구 사건 기록은 PostgreSQL `GameEventLog`를 기준으로 유지한다.
