# Socket Protocol

## 현재 범위

현재 Socket.IO 프로토콜은 JWT handshake 인증, `ping` / `pong`, `whoami`, 공통 `command` envelope 검증, `JOIN_ROOM` / `LEAVE_ROOM` / `CHANGE_READY` / `START_GAME` / `NEXT_PHASE` / `SELECT_MAFIA_TARGET` / `SELECT_DOCTOR_TARGET` / `SELECT_POLICE_TARGET` / `SEND_CHAT_MESSAGE`, `room:updated` / `game:started` / 자동 phase timer 기반 `phase:changed` / `night:resolved` / `voting:resolved` / `game:finished` / `chat:message` / `player:disconnected` 브로드캐스트, 개인 `role:assigned` / `investigation:result` 전달, `requestId` idempotency, Redis `lock:game:{gameId}` command 직렬화, Redis recent chat cache, 그리고 `command:accepted` / `command:rejected` 응답을 제공한다.

## 연결

Socket.IO 연결에는 JWT handshake 인증이 필요하다. 토큰은 `socket.handshake.auth.token`에서 읽고, 성공 시 서버는 `socket.data.user`에 사용자 정보를 저장한다.

```ts
io('http://localhost:3001', {
  auth: {
    token: accessToken,
  },
});
```

토큰이 없거나 잘못된 경우 연결은 실패한다.

연결이 성립하면 서버는 Redis에 user별 접속 상태를 저장한다. 이 상태는 `userId`, `socketId`, `roomId`, `status`, `connectedAt`, `lastSeenAt`, `disconnectedAt`을 포함하며, `JOIN_ROOM` 후 `roomId`가 갱신되고 `LEAVE_ROOM` 후 `roomId`는 `null`로 정리된다. disconnect 시에는 `DISCONNECTED` 상태가 저장된다. 이 값들은 재접속 복구의 기반이지만, 복구 로직 자체는 아직 구현하지 않는다.

disconnect는 `LEAVE_ROOM`과 다르다. disconnect는 `PlayerLeft`가 아니며 방/게임에서 즉시 제거하지 않고 `player:disconnected` event로 같은 room에 상태만 알린다. payload는 `gameId`, `userId`, `disconnectedAt`, `gracePeriodSeconds`를 포함한다.

reconnect는 command가 아니라 connection lifecycle event다. 서버는 reconnect 시 `reconnect:state` event로 이전 room 복구 결과를 1회 전달한다.

```json
{
  "type": "reconnect:state",
  "userId": "user-1",
  "restored": true,
  "roomId": "room-123",
  "gameId": "room-123",
  "reason": "RESTORED",
  "session": {},
  "player": {},
  "availableActions": [
    {
      "type": "SEND_CHAT_MESSAGE",
      "channel": "DAY"
    }
  ],
  "recentChats": [
    {
      "channel": "DAY",
      "messages": []
    }
  ]
}
```

`reason`은 `RESTORED`, `NO_PREVIOUS_STATE`, `NO_ROOM`, `GAME_SESSION_NOT_FOUND`, `PLAYER_NOT_IN_GAME` 중 하나다. recent chat은 권한에 맞는 channel만 포함하며, `SYSTEM`은 포함하지 않는다.
`availableActions`는 reconnect 시점 snapshot이며, 현재 phase/role/status/connectionStatus 기준으로 계산한 클라이언트 권한 힌트다. 실제 command 허용 여부는 서버 검증이 최종 기준이다.

## 개인 이벤트 채널

인증된 socket은 연결 시 `user:{userId}` room에 join된다. 이 room은 같은 사용자가 여러 탭이나 소켓으로 접속했을 때 공용으로 쓰는 개인 이벤트 채널이다.

`role:assigned`, `MAFIA` / `GHOST` private `chat:message`는 `user:{userId}` room으로 전달된다. 반면 `command:accepted`, `command:rejected`, `reconnect:state`, `pong`, `whoami`는 요청한 현재 socket에만 전달된다.

따라서 room broadcast는 방 전체에, 개인 이벤트는 해당 user room 또는 현재 socket에만 전달된다. 같은 사용자의 다른 socket으로 command 응답이나 reconnect snapshot이 퍼지지 않도록 이 구분을 유지한다.

`requestId`는 같은 `userId` + `gameId` 범위에서 idempotency key로 사용된다. 같은 `requestId`로 완료된 command를 다시 보내면 side effect는 재실행되지 않는다. 이전 결과가 `COMMAND_ACCEPTED`면 `command:accepted`만 다시 받을 수 있고, 이전 결과가 `COMMAND_REJECTED`면 같은 reason/message로 `command:rejected`를 다시 받는다. 같은 request가 아직 처리 중이면 `DUPLICATE_REQUEST_IN_PROGRESS`로 거부된다. idempotency TTL은 `REQUEST_ID_TTL_SECONDS`를 사용하며 기본값은 86400초다.

같은 `gameId`의 command는 Redis lock으로 직렬화된다. lock을 획득하지 못하면 `GAME_LOCK_BUSY`로 거부될 수 있고, 이 경우 client는 새 `requestId`로 재시도해야 한다. lock TTL은 `GAME_COMMAND_LOCK_TTL_MS`를 사용하며 기본값은 5000ms다.
`GAME_LOCK_BUSY`를 받은 같은 `requestId`는 이후에도 같은 rejection이 replay된다. lock이 풀린 뒤 같은 의도의 새 시도를 하려면 새 `requestId`를 사용해야 한다.

성공한 `chat:message`는 Redis 최근 채팅 cache에도 저장된다. cache key는 `chat:recent:{gameId}:{channel}`이고, 기본 보관 개수는 `CHAT_CACHE_LIMIT=50`, TTL은 `CHAT_CACHE_TTL_SECONDS=86400`다. 이 cache는 reconnect 복구 기반이지만, 실제 reconnect 시 자동 전달은 아직 구현하지 않는다.

```json
{
  "type": "player:disconnected",
  "gameId": "room-123",
  "userId": "user-2",
  "disconnectedAt": "2026-05-16T00:00:00.000Z",
  "gracePeriodSeconds": 120
}
```

## ping / pong

클라이언트가 `ping` 이벤트를 보내면 서버는 `pong` 이벤트로 응답한다.

```json
{
  "type": "pong",
  "timestamp": "2026-05-15T00:00:00.000Z"
}
```

## whoami

클라이언트가 `whoami` 이벤트를 보내면 서버는 현재 인증된 사용자를 반환한다.

```json
{
  "id": "userId",
  "email": "user@example.com"
}
```

## room join / leave

클라이언트는 `command` 이벤트로 room 참여와 나가기를 요청한다. room 참여 command는 envelope의 `gameId`를 room 식별자로 사용한다.

```json
{
  "type": "JOIN_ROOM",
  "requestId": "req-2",
  "gameId": "room-123",
  "payload": {
    "nickname": "alpha"
  }
}
```

```json
{
  "type": "LEAVE_ROOM",
  "requestId": "req-3",
  "gameId": "room-123",
  "payload": {}
}
```

성공하면 서버는 `room:updated`로 room snapshot과 participant list를 broadcast하고, 해당 command를 `command:accepted`로 응답한다.

```json
{
  "room": {
    "roomId": "room-123",
    "participants": [
      {
        "userId": "user-1",
        "nickname": "alpha"
      }
    ]
  }
}
```

room이 없거나, 참여할 수 없거나, room 참가자가 아니면 `command:rejected`로 응답한다.

## command rejected

`command:rejected`는 command 실패 응답이다. payload shape는 유지되며 `reason`은 표준 error code를 사용한다.

```json
{
  "type": "COMMAND_REJECTED",
  "requestId": "req-123",
  "reason": "PLAYER_NOT_ALIVE",
  "message": "player is not alive"
}
```

`message`는 사람이 읽을 수 있는 설명이고, client 로직 분기는 `reason` 기준으로 해야 한다. `requestId`는 envelope parse 실패처럼 command 자체를 읽지 못한 경우 비어 있을 수 있다.

주요 code 의미:

- `INVALID_COMMAND_ENVELOPE`: command envelope 형식이 잘못됐다.
- `UNAUTHORIZED`: 인증된 socket user가 없다.
- `DUPLICATE_REQUEST_IN_PROGRESS`: 같은 request가 아직 처리 중이다.
- `GAME_LOCK_BUSY`: 같은 game command lock을 아직 얻지 못했다.
- `ROOM_COMMAND_FAILED`: room command가 내부적으로 실패했다.
- `GAME_SESSION_NOT_FOUND`: game session이 없다.
- `GAME_NOT_IN_PROGRESS`: 게임이 진행 중이 아니다.
- `GAME_ALREADY_FINISHED`: 게임이 이미 종료됐다.
- `GAME_NOT_IN_VOTING`: 투표 phase가 아니다.
- `GAME_NOT_IN_NIGHT`: 밤 액션 phase가 아니다.
- `PLAYER_NOT_IN_GAME`: 해당 player가 game session에 없다.
- `PLAYER_NOT_ALIVE`: 살아 있는 player만 필요한 command다.
- `PLAYER_NOT_DEAD`: 죽은 player만 가능한 command다.
- `TARGET_PLAYER_NOT_FOUND`: target player를 찾지 못했다.
- `TARGET_PLAYER_NOT_ALIVE`: target player가 살아 있지 않다.
- `TARGET_SELF_NOT_ALLOWED`: 자기 자신은 밤 액션 target이 될 수 없다.
- `VOTE_ALREADY_CAST`: 이미 투표했다.
- `ROLE_NOT_ALLOWED`: 현재 role로는 할 수 없다.
- `CHAT_NOT_ALLOWED_IN_CURRENT_PHASE`: 현재 phase에서 chat이 허용되지 않는다.
- `INVALID_CHAT_COMMAND`: chat command payload가 잘못됐다.
- `INVALID_CHAT_CHANNEL`: chat channel이 잘못됐다.
- `INVALID_CHAT_MESSAGE`: chat message가 필요하다.
- `CHAT_MESSAGE_TOO_LONG`: chat message가 너무 길다.

## ready change

클라이언트는 `command` 이벤트로 room 참여자의 준비 상태를 바꾼다.

```json
{
  "type": "CHANGE_READY",
  "requestId": "req-4",
  "gameId": "room-123",
  "payload": {
    "isReady": true
  }
}
```

성공하면 서버는 `room:updated`로 room snapshot과 participant list를 broadcast하고, 해당 command를 `command:accepted`로 응답한다. 준비 상태는 참가자별 `isReady` 값으로 반영된다.

room이 없거나, room 참가자가 아니거나, `isReady`가 boolean이 아니면 `command:rejected`로 응답한다.

## start game

클라이언트는 `command` 이벤트로 room 시작을 요청한다.

```json
{
  "type": "START_GAME",
  "requestId": "req-5",
  "gameId": "room-123",
  "payload": {}
}
```

성공하면 서버는 room 상태를 `IN_PROGRESS`로 바꾸고 `room:updated`로 broadcast한 뒤 `command:accepted`로 응답한다.

방장이 아니거나, 참가자가 4명 미만이거나, 전원이 준비되지 않았거나, room이 이미 시작된 경우에는 `command:rejected`로 응답한다.

성공한 경우 각 사용자에게 `role:assigned`가 개별 전달되고, room 전체에는 `game:started`가 broadcast된다.

## phase transition

게임 시작 후 서버는 phase별 `phaseEndsAt`을 설정하고, 해당 시각이 되면 다음 phase로 자동 전환한다. 클라이언트는 `game:started`와 `phase:changed`의 `phaseEndsAt`을 기준으로 남은 시간을 표시한다.

전환되면 서버는 `phase:changed`로 `fromPhase`, `toPhase`, `turn`, `phaseEndsAt`, `requestedByUserId`를 broadcast한다. 자동 전환인 경우 `requestedByUserId`는 `null`이다.

`FINISHED`인 게임은 더 이상 다음 phase로 전환되지 않는다.
`NIGHT -> DAY_DISCUSSION` 또는 `VOTING -> RESULT` 전환 때는 `PhaseChanged`가 먼저 기록되고, 그 뒤에 결과 사건과 필요하면 `GameFinished`가 기록된다.
실시간 UI 복구를 위해 `NIGHT -> DAY_DISCUSSION` 전환에서는 `night:resolved`가 추가 broadcast된다. payload는 `attackedUserId`, `protectedUserId`, `killedUserId`를 포함한다.
`VOTING -> RESULT` 전환에서는 `voting:resolved`가 추가 broadcast된다. payload는 `executedUserId`, `voteResult`를 포함한다.
승리 조건이 충족되면 `game:finished`가 broadcast된다.
`NEXT_PHASE` command는 내부 호환 경로로 남아 있지만 일반 UI와 reconnect `availableActions`에는 제공하지 않는다.

## night actions

클라이언트는 `command` 이벤트로 밤 액션을 보낸다.

```json
{
  "type": "SELECT_MAFIA_TARGET",
  "requestId": "req-7",
  "gameId": "room-123",
  "payload": {
    "targetUserId": "user-2"
  }
}
```

`SELECT_DOCTOR_TARGET`와 `SELECT_POLICE_TARGET`도 같은 envelope를 사용한다. 밤 액션은 `NIGHT` phase에서만 허용되며, 역할이 맞지 않거나 대상이 없으면 `command:rejected`로 응답한다. 각 역할의 밤 능력은 한 밤에 한 번만 선택할 수 있고, 의사는 자기 자신을 보호할 수 있다. 마피아와 경찰은 자기 자신을 대상으로 선택할 수 없다.
밤 액션 대상은 살아 있는 player여야 하며, 죽은 player를 target으로 선택하면 `command:rejected`로 응답한다.
밤 액션은 자기 자신을 target으로 선택할 수 없다. 경찰 조사 성공 시 경찰 개인에게 `investigation:result`가 전달된다.

## voting

클라이언트는 `command` 이벤트로 투표를 보낸다.

```json
{
  "type": "CAST_VOTE",
  "requestId": "req-8",
  "gameId": "room-123",
  "payload": {
    "targetUserId": "user-2"
  }
}
```

투표는 `VOTING` phase에서만 허용되며, 살아있는 유저만 보낼 수 있다. 같은 `requestId`의 재전송은 1차 중복 차단 대상으로 처리된다. 서버는 투표를 저장하고 `command:accepted`로 응답한다.

## chat

클라이언트는 `command` 이벤트로 로비 채팅과 낮 채팅을 보낸다.

```json
{
  "type": "SEND_CHAT_MESSAGE",
  "requestId": "req-chat-1",
  "gameId": "room-123",
  "payload": {
    "channel": "DAY",
    "message": "저는 시민입니다."
  }
}
```

지원 채널은 `LOBBY`, `DAY`, `MAFIA`, `GHOST`다. `SYSTEM`, `END` 채널은 아직 command로 지원하지 않는다.

`LOBBY` / `DAY` 채팅은 같은 room에 `chat:message`를 broadcast하고, `MAFIA` / `GHOST` 채팅은 권한 있는 대상에게만 private delivery한다. 해당 command는 `command:accepted`로 응답한다.

```json
{
  "type": "chat:message",
  "gameId": "room-123",
  "channel": "DAY",
  "message": "저는 시민입니다.",
  "senderUserId": "user-1",
  "sentAt": "2026-05-16T00:00:00.000Z"
}
```

로비 채팅은 `WAITING` room의 participant만 가능하고, 낮 채팅은 `DAY_DISCUSSION` phase의 살아 있는 player만 가능하다.
마피아 채팅은 `NIGHT` phase의 살아 있는 마피아만 보낼 수 있고, 살아 있는 마피아에게만 전달된다.
유령 채팅은 죽은 player만 보낼 수 있고, 죽은 player에게만 전달된다.
서버 시스템 메시지는 같은 `chat:message` 구조를 사용하지만, 현재 client command는 아직 미지원이다.
성공한 chat 메시지는 Redis 최근 채팅 cache에 저장된다.

실패 시 `INVALID_CHAT_COMMAND`, `INVALID_CHAT_CHANNEL`, `INVALID_CHAT_MESSAGE`, `CHAT_MESSAGE_TOO_LONG`, `ROOM_NOT_FOUND`, `CHAT_NOT_ALLOWED_IN_CURRENT_PHASE`, `PARTICIPANT_NOT_FOUND`, `GAME_SESSION_NOT_FOUND`, `PLAYER_NOT_IN_GAME`, `PLAYER_NOT_ALIVE`, `PLAYER_NOT_DEAD`, `ROLE_NOT_ALLOWED`, `UNAUTHORIZED` 중 하나로 거부된다.

## chat 권한 matrix

| Channel | 송신 조건 | phase / status 조건 | 수신 대상 | visibilityDuringGame |
| --- | --- | --- | --- | --- |
| LOBBY | room participant | room status `WAITING` | room 전체 | `PUBLIC` |
| DAY | game player | `DAY_DISCUSSION` + `ALIVE` | room 전체 | `PUBLIC` |
| MAFIA | `MAFIA` player | `NIGHT` + `ALIVE` | 살아있는 `MAFIA`만 | `MAFIA_ONLY` |
| GHOST | game player | `DEAD` | 죽은 player만 | `GHOST_ONLY` |
| SYSTEM | client command 불가 | 없음 | 서버 발행 전용 | `SYSTEM_ONLY` 예정 |

## recent chat cache

성공한 `chat:message`는 Redis list `chat:recent:{gameId}:{channel}`에 저장된다. 기본 보관 개수는 `CHAT_CACHE_LIMIT=50`이고, TTL은 `CHAT_CACHE_TTL_SECONDS=86400`이다. 이 cache는 reconnect 복구 기반이며, 실제 reconnect 시 전달 로직은 아직 구현하지 않는다.

## command

클라이언트는 `command` 이벤트로 공통 envelope를 보낸다.

```json
{
  "type": "PING_COMMAND",
  "requestId": "req-1",
  "gameId": "game-1",
  "payload": {}
}
```

검증 규칙:

- command는 object여야 한다.
- `type`은 비어 있지 않은 string이어야 한다.
- `requestId`는 비어 있지 않은 string이어야 한다.
- `gameId`는 비어 있지 않은 string이어야 한다.
- `payload` 필드는 존재해야 한다.

정상 command는 `command:accepted`로 응답한다.

```json
{
  "type": "COMMAND_ACCEPTED",
  "requestId": "req-1",
  "receivedType": "PING_COMMAND"
}
```

비정상 command는 `command:rejected`로 응답한다.

```json
{
  "type": "COMMAND_REJECTED",
  "reason": "INVALID_COMMAND_ENVELOPE",
  "message": "Command envelope is invalid."
}
```

requestId가 없는 command는 거부된다.

## 이후 확장 예정

- END 채팅 command
- SEND_SYSTEM_MESSAGE command
- rate limiting
- 최근 채팅 Redis 캐시
- reconnect 복구
- viewer role 기반 visibility 필터링
