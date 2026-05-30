# ADR-002. 멀티 인스턴스 실시간 상태 공유와 이벤트 전달

## Status

Proposed

## Context

Mafia Casefile은 Socket.IO 기반 실시간 게임 서버다. 운영 환경에서 API 서버가 2대 이상이면 사용자는 서로 다른 API 인스턴스에 연결될 수 있다.

현재 `RoomsService`는 room 상태를 process-local `Map`에 저장한다. 또한 Socket.IO는 기본 in-memory adapter를 사용한다.

## Evidence

다음 characterization test는 현재 구조의 멀티 인스턴스 한계를 재현한다.

- `apps/api/src/rooms/rooms.multi-instance.spec.ts`
  - 한 `RoomsService` 인스턴스에서 생성한 room은 다른 `RoomsService` 인스턴스에서 조회하거나 참가할 수 없다.
- `apps/api/src/realtime/realtime.multi-instance.spec.ts`
  - 기본 Socket.IO adapter는 한 서버 인스턴스에서 broadcast한 이벤트를 다른 서버 인스턴스에 연결된 socket으로 전달하지 않는다.

검증 명령:

```bash
pnpm --filter api test:multi-instance
```

## Decision

멀티 인스턴스 운영을 지원하려면 다음 변경이 필요하다.

1. Room 상태를 process-local `Map`에서 Redis 기반 저장소로 옮긴다.
2. Socket.IO Redis Adapter를 적용해 room broadcast와 개인 이벤트를 인스턴스 간 전달한다.
3. 자동 phase timer는 process-local `setTimeout`만으로 운영하지 않고 Redis/worker 기반 만료 처리로 이전한다.
4. Redis snapshot과 PostgreSQL `GameEventLog`를 조합해 재접속 복구와 이벤트 보정을 수행한다.

## Consequences

- API 인스턴스가 여러 대여도 같은 room 상태를 조회하고 갱신할 수 있다.
- 서로 다른 API 인스턴스에 연결된 사용자가 같은 room 이벤트를 받을 수 있다.
- Redis 장애, replica lag, lock 안정성, Pub/Sub 유실 가능성은 별도 설계와 테스트가 필요하다.
- 영구 사건 기록은 PostgreSQL `GameEventLog`를 기준으로 유지한다.
