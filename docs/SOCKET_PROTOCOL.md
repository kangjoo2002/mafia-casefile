# Socket Protocol

## 현재 범위

현재 Socket.IO 프로토콜은 JWT handshake 인증, `ping` / `pong`, `whoami`, 그리고 공통 `command` envelope 검증과 `command:accepted` / `command:rejected` 응답을 제공한다.

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

- room join/leave
- game command 처리
- GameEvent 저장
