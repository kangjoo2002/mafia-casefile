# ADR-001 Event Record

## Status

Accepted

## Background

게임 중 발생하는 의미 있는 사건은 단순 실시간 전달만으로는 충분하지 않다. 게임 종료 후 복기와 정렬 가능한 타임라인을 위해 영구 저장 기준이 필요하다.

## Decision

영구 사건 기록은 PostgreSQL `GameEventLog`에 저장한다. Redis와 Socket.IO는 전달 및 임시 상태 수단으로만 사용한다. 타임라인 정렬은 `createdAt`이 아니라 `gameId + seq` 기준으로 한다. 게임 중 공개 범위와 게임 종료 후 공개 범위를 분리한다.

## Consequences

- 사건 기록은 게임 데이터와 함께 영구적으로 보존된다.
- 동일 게임 안에서 사건 순서는 `seq`로 안정적으로 정렬된다.
- 공개 범위 정책을 기록 단계에서 분리할 수 있다.
- 실제 조회 API는 이후 작업에서 구현한다.
- `GameEventRecorderService.recordEvent()`는 영구 사건 기록의 단일 진입점이다.
