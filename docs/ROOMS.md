# Rooms API

## 현재 범위

현재 HTTP rooms API는 로비와 방 상태를 다루는 dev/test용 경로다. `POST /rooms`는 아직 JWT 기반 host 확정이 적용되지 않았고, request body의 `hostUserId`를 그대로 신뢰한다.

## 현재 동작

- `POST /rooms`: request body의 `hostUserId`로 방장과 최초 참가자를 생성한다.
- `GET /rooms`: 현재 방 목록을 조회한다.
- `GET /rooms/:roomId`: 특정 방 상세를 조회한다.

## 제한 사항

- 현재 HTTP rooms API는 JWT 기반 host 확정이 아직 적용되지 않았다.
- `hostUserId`는 현재 request body에서 전달된다.
- 운영 수준의 인증/권한 기준에서는 JWT `sub`에서 hostUserId를 확정해야 한다.
- 이 보완은 이후 HTTP Auth Guard 또는 권한 정리 작업에서 처리한다.
- Socket.IO command 흐름은 JWT handshake 인증을 사용한다.

## 참고

현재 구현은 로컬 개발과 테스트를 위한 최소 방 API다. 운영용 인증/권한 검증은 이후 작업에서 정리한다.
