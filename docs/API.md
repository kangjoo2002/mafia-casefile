# API

## 현재 범위

현재 HTTP API는 `health`, `rooms` 생성/조회, 그리고 `auth` 회원가입/로그인을 제공한다.

## Rooms API

### 방 생성

`POST /rooms`

요청 바디:

```json
{
  "hostUserId": "user-1",
  "name": "새 방",
  "maxPlayers": 8
}
```

응답:

```json
{
  "room": {
    "roomId": "room-id",
    "name": "새 방",
    "hostUserId": "user-1",
    "status": "WAITING",
    "playerCount": 1,
    "maxPlayers": 8,
    "createdAt": "2026-05-16T12:00:00.000Z",
    "updatedAt": "2026-05-16T12:00:00.000Z"
  }
}
```

### 방 목록 조회

`GET /rooms`

방 목록은 최신 생성 순서로 반환한다.

응답:

```json
{
  "rooms": []
}
```

### 방 상세 조회

`GET /rooms/:roomId`

응답:

```json
{
  "room": {
    "roomId": "room-id"
  }
}
```

## 현재 저장 방식

방 정보는 현재 인메모리 저장소로 관리한다. 이후 작업에서 참가/나가기와 함께 상태 저장 방식을 확장할 예정이다.

## 사건 타임라인 조회

`GET /games/:gameId/timeline`

특정 게임의 사건 기록을 `seq` 오름차순으로 조회한다. 기본 응답은 `visibilityAfterGame = PUBLIC`인 사건만 포함한다.

웹 복기 페이지는 `/games/:gameId/timeline` 경로에서 이 API를 사용한다.

이벤트가 없으면 `200`과 빈 `events` 배열을 반환한다.

응답 예:

```json
{
  "gameId": "game-123",
  "events": [
    {
      "id": "event-id",
      "gameId": "game-123",
      "seq": 1,
      "type": "GameStarted",
      "turn": 0,
      "phase": "WAITING",
      "actorUserId": null,
      "payload": {
        "startedByUserId": "user-1"
      },
      "visibilityDuringGame": "PUBLIC",
      "visibilityAfterGame": "PUBLIC",
      "requestId": "req-start",
      "createdAt": "2026-05-16T00:00:00.000Z"
    }
  ]
}
```
