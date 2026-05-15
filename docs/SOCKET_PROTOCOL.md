# Socket Protocol

## 현재 범위

현재 Socket.IO 프로토콜은 JWT handshake 인증이 필요한 기본 연결과 `ping` / `pong` / `whoami` 이벤트만 제공한다.

## 개발 CORS origin

개발 환경의 CORS origin은 `WEB_ORIGIN` 환경변수를 사용한다. 값이 없으면 `http://localhost:3000`을 사용한다.

## 연결 예시

```ts
io('http://localhost:3001', {
  auth: {
    token: accessToken,
  },
});
```

## ping 이벤트

클라이언트가 `ping` 이벤트를 보내면 서버는 `pong` 이벤트로 응답한다.

응답 형식:

```json
{
  "type": "pong",
  "timestamp": "2026-05-15T00:00:00.000Z"
}
```

## whoami 이벤트

클라이언트가 `whoami` 이벤트를 보내면 서버는 현재 인증된 사용자를 반환한다.

응답 형식:

```json
{
  "id": "userId",
  "email": "user@example.com"
}
```

## 인증

Socket.IO 연결에는 JWT handshake 인증이 필요하다. 토큰은 `socket.handshake.auth.token`에서 읽고, 성공 시 서버는 `socket.data.user`에 사용자 정보를 저장한다.

토큰이 없거나 잘못된 경우 연결은 실패한다.

## 이후 확장 예정

- room join/leave
- command / event envelope
- 게임 이벤트
