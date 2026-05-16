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

## 밤 액션

- `SELECT_MAFIA_TARGET`, `SELECT_DOCTOR_TARGET`, `SELECT_POLICE_TARGET`는 `NIGHT` phase에서만 허용된다.
- `SELECT_MAFIA_TARGET`는 살아있는 마피아만 사용할 수 있다.
- `SELECT_DOCTOR_TARGET`는 살아있는 의사만 사용할 수 있다.
- `SELECT_POLICE_TARGET`는 살아있는 경찰만 사용할 수 있다.
- 밤 액션 결과는 `GameSession.nightActions`에 반영되고, `GameEventLog`에도 기록된다.

## 투표

- `CAST_VOTE`는 `VOTING` phase에서만 허용된다.
- 살아있는 유저만 투표할 수 있다.
- 한 유저는 한 투표 턴에 한 번만 투표할 수 있다.
- 같은 `requestId`의 재전송은 1차 중복 차단 대상으로 처리된다.
- 투표 결과는 `GameSession.votes`와 `GameEventLog`의 `VoteCasted` 사건으로 추적한다.

## 처형과 종료

- `NEXT_PHASE`로 `VOTING -> RESULT`를 진행하면 현재 투표 결과를 기준으로 처형이 해소된다.
- 가장 많은 표를 받은 대상이 처형되며, 동률이거나 표가 없으면 처형은 생략된다.
- `NEXT_PHASE`로 `NIGHT -> DAY_DISCUSSION`을 진행하면 밤 선택 결과가 해소된다.
- `PlayerExecuted`, `PlayerKilled`, `GameFinished`는 해소 결과와 종료 조건에 따라 기록된다.
- 마피아가 모두 탈락하면 시민 승리, 마피아 수가 생존한 비마피아 수 이상이면 마피아 승리다.
- `FINISHED` phase는 종료 상태이며, 더 이상 게임 액션을 받을 수 없다.

## 검증 원칙

- `NEXT_PHASE`는 현재 game session의 phase에 따라만 허용된다.
- `PhaseChanged` 사건은 phase 전환이 확정될 때 기록된다.
- `FINISHED`인 게임은 phase 전환 command를 더 이상 받지 않는다.
