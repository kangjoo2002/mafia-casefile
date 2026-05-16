# Event Catalog

## 1. 목적

- GameEvent는 게임 중 의미 있는 행동이 확정되었을 때 남기는 사건 기록이다.
- GameEvent는 실시간 broadcast와 게임 종료 후 타임라인 복기의 기준이 된다.
- Redis나 Socket.IO 이벤트는 전달 수단이며, 영구 사건 기록의 기준은 PostgreSQL `GameEventLog`다.
- 이 카탈로그의 이벤트는 이후 `GameEventLog.type`으로 저장된다.
- `gameId + seq`가 타임라인 정렬 기준이다.
- `GameEventRecorderService`가 `recordEvent()`로 `GameEventLog`를 저장한다.
- `gameId`별 `seq`는 `recordEvent()`에서 발급한다.
- `getTimeline(gameId)`는 `seq` 오름차순으로 사건을 조회한다.
- `GET /games/:gameId/timeline`은 `GameEventLog`를 `seq` 기준으로 조회한다.
- 기본 응답은 `visibilityAfterGame = PUBLIC` 사건만 포함한다.
- `JOIN_ROOM` / `LEAVE_ROOM`은 room 참여 상태를 바꾸고 `PlayerJoined` / `PlayerLeft`를 남긴다.
- `START_GAME`은 `GameStarted`와 `RoleAssigned`를 남기고, 역할은 개인에게만 전송된다.
- `NEXT_PHASE`는 `PhaseChanged`를 남기고, phase 전환은 `NIGHT` / `DAY_DISCUSSION` / `VOTING` / `RESULT` 순환 흐름을 따른다.
- `SELECT_MAFIA_TARGET` / `SELECT_DOCTOR_TARGET` / `SELECT_POLICE_TARGET`는 `NIGHT`에서만 허용되고, 각 선택은 대응하는 night event로 저장된다.
- `SEND_CHAT_MESSAGE`는 LOBBY / DAY / MAFIA / GHOST 채팅이 확정될 때 `ChatMessageSent`를 남긴다. 현재 지원 채널은 LOBBY, DAY, MAFIA, GHOST다. SYSTEM 메시지는 서버 발행용 구조만 정의되어 있고, client command는 아직 미지원이다.
- 채팅 Redis 캐시와 rate limiting은 아직 미구현이다.
- `CAST_VOTE`는 `VOTING`에서만 허용되고, requestId 중복은 1차로 차단된다.
- `NEXT_PHASE`가 결과 phase로 넘어갈 때는 `PhaseChanged`가 먼저 기록되고, 그 뒤에 `PlayerKilled`, `PlayerExecuted`, `GameFinished`가 이어질 수 있다.
- room 참여 변경은 `room:updated` broadcast와 함께 반영된다.

## 2. GameEvent 기본 원칙

- 모든 사건은 `gameId`를 가진다.
- 모든 사건은 `gameId` 안에서 증가하는 `seq`를 가진다.
- 타임라인 정렬은 `createdAt`이 아니라 `seq` 기준이다.
- 사건은 발생 당시 `turn`과 `phase`를 가진다.
- 게임 중 공개 범위와 게임 종료 후 공개 범위를 분리한다.
- `requestId`가 있는 command에서 발생한 사건은 `requestId`를 함께 저장한다.

## 3. 공통 필드

- `id`
- `gameId`
- `seq`
- `type`
- `turn`
- `phase`
- `actorUserId`
- `payload`
- `visibilityDuringGame`
- `visibilityAfterGame`
- `requestId`
- `createdAt`

위 필드는 Prisma `GameEventLog` 모델에 반영되어 있다.

## 4. 공개 범위

- `PUBLIC`: 모든 참가자와 관전자에게 공개된다.
- `PRIVATE`: 특정 사용자 또는 단일 대상에게만 공개된다.
- `MAFIA_ONLY`: 마피아 진영에게만 공개된다.
- `GHOST_ONLY`: 탈락한 플레이어 또는 관전자에게만 공개된다.
- `SYSTEM_ONLY`: 클라이언트 UI에는 공개하지 않고 서버 운영용으로만 남긴다.

## 5. 이벤트 카탈로그

| Event type | 발생 시점 | actor | payload 예시 | 게임 중 공개 범위 | 게임 종료 후 공개 범위 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| PlayerJoined | 방 참가가 확정될 때 | user | roomId, userId, nickname | PUBLIC | PUBLIC | 이후 room 기능과 연결 |
| PlayerLeft | 방 나가기가 확정될 때 | user | roomId, userId, reason | PUBLIC | PUBLIC | 정상 종료와 강제 종료를 구분 가능 |
| PlayerReadyChanged | 준비 상태 변경이 확정될 때 | user | userId, isReady | PUBLIC | PUBLIC | 게임 시작 전 상태 관리 |
| GameStarted | 게임 시작이 확정될 때 | system | gameId, startedByUserId | PUBLIC | PUBLIC | 초기 상태 전환 기준 |
| RoleAssigned | 역할 배정이 확정될 때 | system | userId, role | PRIVATE | PUBLIC | 각 사용자에게 개인 전달 |
| PhaseChanged | phase 전환이 확정될 때 | system | fromPhase, toPhase, turn | PUBLIC | PUBLIC | 타임라인 기준 이벤트 |
| ChatMessageSent | 로비, 낮, 마피아, 유령 채팅이 확정될 때 | user | channel, message, senderUserId | PUBLIC / MAFIA_ONLY / GHOST_ONLY | PUBLIC | 현재는 LOBBY, DAY, MAFIA, GHOST 채팅 command가 구현되어 있다. SYSTEM command는 아직 미지원이다 |
| VoteCasted | 투표가 확정될 때 | user | targetUserId, voteType | PUBLIC | PUBLIC | 현재 표 상태의 근거 |
| PlayerExecuted | 처형이 확정될 때 | system | targetUserId, voteResult | PUBLIC | PUBLIC | 낮 phase 결과 |
| PlayerKilled | 사망이 확정될 때 | system | targetUserId, cause | PUBLIC | PUBLIC | 밤 phase 결과 |
| MafiaTargetSelected | 마피아 타깃이 확정될 때 | user/system | targetUserId | MAFIA_ONLY | PUBLIC | 마피아 내부 선택 기록 |
| DoctorTargetSelected | 의사 타깃이 확정될 때 | user/system | targetUserId | PRIVATE | PUBLIC | 개인 행동 기록 |
| PoliceInvestigated | 경찰 조사 결과가 확정될 때 | user/system | targetUserId, result | PRIVATE | PUBLIC | 조사 결과를 개인에게만 노출 가능 |
| PlayerDisconnected | 연결 끊김이 확정될 때 | system | userId, reason | SYSTEM_ONLY | PUBLIC | 세션 문제 추적용 |
| SessionRecovered | 재연결 복구가 확정될 때 | system | userId, sessionId | SYSTEM_ONLY | PUBLIC | 중단 복구 추적용 |
| GameFinished | 게임 종료가 확정될 때 | system | winnerTeam, reason | PUBLIC | PUBLIC | 최종 타임라인 마감 |

## 6. Command/Event 매핑

| Command | 생성되는 Event | requestId 필요 여부 | 상태 변경 여부 | 비고 |
| --- | --- | --- | --- | --- |
| JOIN_ROOM | PlayerJoined | yes | yes | 이후 room 참가 흐름 |
| LEAVE_ROOM | PlayerLeft | yes | yes | 정상 종료 또는 이탈 |
| CHANGE_READY | PlayerReadyChanged | yes | yes | 준비 상태 토글 |
| START_GAME | GameStarted / RoleAssigned | yes | yes | 게임 시작 및 역할 배정 |
| SEND_CHAT_MESSAGE | ChatMessageSent | yes | yes | 메시지 기록 |
| CAST_VOTE | VoteCasted | yes | yes | 투표 확정 기록 |
| SELECT_MAFIA_TARGET | MafiaTargetSelected | yes | yes | 마피아 전용 선택 |
| SELECT_DOCTOR_TARGET | DoctorTargetSelected | yes | yes | 의사 전용 선택 |
| SELECT_POLICE_TARGET | PoliceInvestigated | yes | yes | 경찰 조사 결과 기록 |
| NEXT_PHASE | PhaseChanged | yes | yes | phase 전환 기록 |
| FINISH_GAME | GameFinished | yes | yes | 종료 사유와 승리 진영 기록 |

모든 command는 `requestId`가 필요하다.

## 7. 아직 구현하지 않는 것

- viewer role 기반 visibility 필터링
- 인증/인가 기반 timeline 접근 제어
- includePrivate 같은 관리자/개발용 조회 옵션
- END 채팅 command
- SEND_SYSTEM_MESSAGE command
- 채팅 Redis 캐시
- rate limiting
- reconnect 복구

기본 timeline 조회 API는 추가되었고, 현재 응답은 `visibilityAfterGame = PUBLIC` 사건만 포함한다. viewer role 기반 세부 공개 범위 필터링은 이후 작업에서 구현한다.
