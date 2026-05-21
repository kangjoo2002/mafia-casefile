export function displayRoomStatus(value: string | null | undefined) {
  switch (value) {
    case "WAITING":
      return "대기 중";
    case "IN_PROGRESS":
      return "게임 중";
    case "FINISHED":
      return "종료";
    default:
      return "미정";
  }
}

export function displayPhase(value: string | null | undefined) {
  switch (value) {
    case "WAITING":
      return "대기실";
    case "IN_PROGRESS":
      return "게임 중";
    case "NIGHT":
      return "밤";
    case "DAY_DISCUSSION":
      return "낮 토론";
    case "VOTING":
      return "투표";
    case "RESULT":
      return "결과";
    case "FINISHED":
      return "게임 종료";
    default:
      return "미정";
  }
}

export function displayRole(value: string | null | undefined) {
  switch (value) {
    case "MAFIA":
      return "마피아";
    case "DOCTOR":
      return "의사";
    case "POLICE":
      return "경찰";
    case "CITIZEN":
      return "시민";
    default:
      return "아직 모름";
  }
}

export function displayPlayerStatus(value: string | null | undefined) {
  switch (value) {
    case "ALIVE":
      return "생존";
    case "DEAD":
      return "사망";
    default:
      return "미정";
  }
}

export function displayConnectionStatus(value: string | null | undefined) {
  switch (value) {
    case "CONNECTED":
      return "접속";
    case "DISCONNECTED":
      return "이탈";
    default:
      return "미정";
  }
}

export function displayChatChannel(value: string | null | undefined) {
  switch (value) {
    case "LOBBY":
      return "대기실";
    case "DAY":
      return "낮";
    case "MAFIA":
      return "마피아";
    case "GHOST":
      return "유령";
    case "SYSTEM":
      return "시스템";
    default:
      return "채팅";
  }
}

export function commandRejectMessage(reason: string) {
  switch (reason) {
    case "ROOM_NOT_FOUND":
      return "방을 찾을 수 없습니다.";
    case "ROOM_FULL":
      return "방이 가득 찼습니다.";
    case "ROOM_NOT_JOINABLE":
      return "지금 참가할 수 없는 방입니다.";
    case "NOT_ROOM_HOST":
      return "방장만 할 수 있습니다.";
    case "ROOM_TOO_SMALL":
    case "ROOM_NOT_READY":
    case "ROOM_NOT_STARTABLE":
      return "아직 게임을 시작할 수 없습니다.";
    case "GAME_LOCK_BUSY":
      return "잠시 후 다시 시도하세요.";
    case "GAME_NOT_IN_NIGHT":
      return "밤에만 할 수 있습니다.";
    case "GAME_NOT_IN_VOTING":
      return "투표 시간에만 할 수 있습니다.";
    case "PLAYER_NOT_ALIVE":
      return "생존자만 할 수 있습니다.";
    case "PLAYER_NOT_DEAD":
      return "사망자만 할 수 있습니다.";
    case "TARGET_SELF_NOT_ALLOWED":
      return "자기 자신은 대상으로 선택할 수 없습니다.";
    case "TARGET_PLAYER_NOT_ALIVE":
      return "사망자는 대상으로 선택할 수 없습니다.";
    case "ROLE_NOT_ALLOWED":
      return "현재 역할로는 할 수 없습니다.";
    case "VOTE_ALREADY_CAST":
      return "이미 투표했습니다.";
    case "INVALID_CHAT_CHANNEL":
    case "CHAT_NOT_ALLOWED_IN_CURRENT_PHASE":
      return "지금 사용할 수 없는 채팅입니다.";
    case "CHAT_MESSAGE_TOO_LONG":
      return "메시지가 너무 깁니다.";
    default:
      return reason;
  }
}

export function statusClass(value: string) {
  if (value === "CONNECTED" || value === "ALIVE" || value === "restored") {
    return "status-pill--good";
  }

  if (value === "DISCONNECTED" || value === "DEAD") {
    return "status-pill--bad";
  }

  if (value === "UNKNOWN" || value === "idle") {
    return "status-pill--warn";
  }

  return "";
}
