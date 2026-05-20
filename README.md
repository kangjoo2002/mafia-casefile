# Mafia Casefile

Mafia Casefile는 Socket.IO 기반 실시간 마피아 게임 서버와, 게임 종료 후 사건 타임라인을 복기하는 웹 UI를 함께 제공하는 프로젝트입니다.

## Demo UI

`apps/web`에는 브라우저에서 실제로 4명이 한 판을 진행할 수 있는 최소 UI가 있습니다.

### 실행

1. API를 실행합니다.
   - `pnpm --filter api start:dev`
1. Web을 실행합니다.
   - `pnpm --filter web dev`
1. 브라우저에서 `http://localhost:3000/play`를 엽니다.

### 4인 데모 절차

1. 각 브라우저에서 서로 다른 `userId`, `email`, `nickname`을 입력합니다.
1. `토큰 발급`을 눌러 로컬 데모용 JWT를 만듭니다.
1. 각 브라우저에서 `소켓 연결`을 누릅니다.
1. 호스트가 `방 생성`을 누르면 host socket은 자동으로 방에 참가합니다.
   - 자동 참가 실패 시 호스트도 `방 참가` 버튼을 누릅니다.
1. 나머지 3명이 `roomId`를 입력하고 `방 참가`를 누릅니다.
1. 전원이 `Ready 토글`을 눌러 준비를 마칩니다.
1. 호스트가 `게임 시작`을 누릅니다.
1. 낮 채팅, 밤 액션, 투표를 진행합니다.
1. 게임이 끝나면 `/games/{roomId}/timeline` 링크로 결과 타임라인을 확인합니다.

### 참고

- `POST /api/demo-token`은 로컬 데모용입니다.
- UI의 availableActions는 reconnect snapshot 또는 client-side phase/role/status 계산을 기준으로 버튼을 표시하며, 실제 권한은 서버 command 검증이 최종 기준입니다.
- 스크린샷과 GIF 정리는 다음 작업-045에서 진행합니다.
