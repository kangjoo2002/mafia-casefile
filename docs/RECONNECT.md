# Reconnect

disconnect 시 플레이어를 즉시 게임에서 제거하지 않는다. 대신 `GameSession` player의 `connectionStatus`를 `DISCONNECTED`로 바꾸고 `lastSeenAt`을 갱신한다.

기본 grace period는 `DISCONNECT_GRACE_PERIOD_SECONDS=120`초다. 이 값은 reconnect 유예 시간으로만 사용되며, grace period 만료 후 강제 제거 처리는 아직 구현하지 않는다.

disconnect는 `LEAVE_ROOM`과 다르다. `LEAVE_ROOM`은 방을 실제로 나가는 명령이고, disconnect는 네트워크 끊김만 반영한다.

reconnect 복구는 작업-037에서 구현한다.
