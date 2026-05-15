# Socket Protocol

## 현재 범위

현재 Socket.IO 프로토콜은 기본 연결과 `ping` / `pong` 이벤트만 제공한다.

## 개발 CORS origin

개발 환경의 CORS origin은 `WEB_ORIGIN` 환경변수를 사용한다. 값이 없으면 `http://localhost:3000`을 사용한다.

## ping 이벤트

클라이언트가 `ping` 이벤트를 보내면 서버는 `pong` 이벤트로 응답한다.

응답 형식:

```json
{
  "type": "pong",
  "timestamp": "2026-05-15T00:00:00.000Z"
}
```

## 인증

현재 Socket.IO 연결에는 인증을 적용하지 않았다. 다음 단계에서 JWT handshake 인증을 추가할 예정이다.

## 이후 확장 예정

- room join/leave
- command / event envelope
- 게임 이벤트
