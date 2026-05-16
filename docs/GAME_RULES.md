# Game Rules

## Phase 흐름

- 게임 시작 전에는 `WAITING` phase에서 room 참가와 준비 상태를 관리한다.
- 게임이 시작되면 `NIGHT` phase로 진입한다.
- `NEXT_PHASE` command는 `NIGHT -> DAY_DISCUSSION -> VOTING -> RESULT -> NIGHT` 순서로 phase를 전환한다.
- `FINISHED` phase는 종료 상태이며, 더 이상 다음 phase로 전환하지 않는다.

## Turn 규칙

- `turn`은 낮 토론이 시작될 때 증가한다.
- 따라서 첫 `NIGHT`는 `turn = 0`으로 시작하고, 첫 `DAY_DISCUSSION`은 `turn = 1`이 된다.
- 이후 `RESULT -> NIGHT` 전환에서는 `turn`을 유지하고, 다음 `NIGHT -> DAY_DISCUSSION`에서 다시 증가한다.

## 검증 원칙

- `NEXT_PHASE`는 현재 game session의 phase에 따라만 허용된다.
- `PhaseChanged` 사건은 phase 전환이 확정될 때 기록된다.
- `FINISHED`인 게임은 phase 전환 command를 더 이상 받지 않는다.
