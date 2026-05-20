# Reconnect

disconnect 시 플레이어를 즉시 게임에서 제거하지 않는다. 대신 `GameSession` player의 `connectionStatus`를 `DISCONNECTED`로 바꾸고 `lastSeenAt`을 갱신한다.

기본 grace period는 `DISCONNECT_GRACE_PERIOD_SECONDS=120`초다. 이 값은 reconnect 유예 시간으로만 사용되며, grace period 만료 후 강제 제거 처리는 아직 구현하지 않는다.

disconnect는 `LEAVE_ROOM`과 다르다. `LEAVE_ROOM`은 방을 실제로 나가는 명령이고, disconnect는 네트워크 끊김만 반영한다.

reconnect 시에는 이전 `roomId`를 확인해 같은 `user:{userId}` room과 game room을 다시 join하고, `GameSession` player의 `connectionStatus`를 `CONNECTED`로 되돌린다.
reconnect는 `reconnect:state` event로 현재 session, player, 권한에 맞는 recent chat snapshot과 `availableActions`를 전달한다.
`reconnect:state`는 reconnect한 socket에만 전달되며, 같은 user의 다른 socket에는 broadcast하지 않는다.

`availableActions`는 reconnect 시점의 snapshot이다. 이후 phase 변경이나 사망, disconnect 상태 변화가 생기면 클라이언트는 다시 갱신된 값을 받아야 한다.
