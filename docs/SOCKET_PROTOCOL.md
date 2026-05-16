# Socket Protocol

## 현재 범위

현재 Socket.IO 프로토콜은 JWT handshake 인증, `ping` / `pong`, `whoami`, 공통 `command` envelope 검증, `JOIN_ROOM` / `LEAVE_ROOM` / `CHANGE_READY` / `START_GAME` / `NEXT_PHASE` / `SELECT_MAFIA_TARGET` / `SELECT_DOCTOR_TARGET` / `SELECT_POLICE_TARGET`, `room:updated` / `game:started` / `phase:changed` 브로드캐스트, 개인 `role:assigned` 전달, 그리고 `command:accepted` / `command:rejected` 응답을 제공한다.

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

클라이언트는 `command` 이벤트로 다음 phase 전환을 요청한다.

```json
{
  "type": "NEXT_PHASE",
  "requestId": "req-6",
  "gameId": "room-123",
  "payload": {}
}
```

성공하면 서버는 `phase:changed`로 `fromPhase`, `toPhase`, `turn`을 broadcast하고, 해당 command를 `command:accepted`로 응답한다.

`FINISHED`인 게임은 더 이상 다음 phase로 전환되지 않는다.
`NEXT_PHASE`가 `NIGHT -> DAY_DISCUSSION` 또는 `VOTING -> RESULT`일 때는 `PhaseChanged`가 먼저 기록되고, 그 뒤에 결과 사건과 필요하면 `GameFinished`가 기록된다.
`NEXT_PHASE`는 방장만 호출할 수 있고, 진행 중인 room에서만 허용된다. 권한이나 상태가 맞지 않으면 `command:rejected`로 응답한다.

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

`SELECT_DOCTOR_TARGET`와 `SELECT_POLICE_TARGET`도 같은 envelope를 사용한다. 밤 액션은 `NIGHT` phase에서만 허용되며, 역할이 맞지 않거나 대상이 없으면 `command:rejected`로 응답한다.
밤 액션 대상은 살아 있는 player여야 하며, 죽은 player를 target으로 선택하면 `command:rejected`로 응답한다.

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

- game command 처리
- GameEvent 저장
- 게임 command가 실제 상태 변경을 만들면 해당 결과는 `docs/EVENT_CATALOG.md`의 GameEvent 카탈로그를 기준으로 기록될 예정이다.
