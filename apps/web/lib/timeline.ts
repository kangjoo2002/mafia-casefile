export type TimelineEvent = {
  id: string;
  gameId: string;
  seq: number;
  type: string;
  turn: number;
  phase: string;
  actorUserId: string | null;
  payload: unknown;
  visibilityDuringGame: string;
  visibilityAfterGame: string;
  requestId: string | null;
  createdAt: string;
};

export type TimelineResponse = {
  gameId: string;
  events: TimelineEvent[];
};

const EVENT_LABELS: Record<string, string> = {
  PlayerJoined: "플레이어 참가",
  PlayerLeft: "플레이어 퇴장",
  PlayerReadyChanged: "준비 상태 변경",
  GameStarted: "게임 시작",
  RoleAssigned: "역할 배정",
  PhaseChanged: "단계 전환",
  VoteCasted: "투표",
  PlayerExecuted: "처형",
  PlayerKilled: "사망",
  MafiaTargetSelected: "마피아 타깃 선택",
  DoctorTargetSelected: "의사 보호 선택",
  PoliceInvestigated: "경찰 조사",
  GameFinished: "게임 종료",
  ChatMessageSent: "채팅",
};

const WINNER_TEAM_LABELS: Record<string, string> = {
  CITIZEN: "시민 팀",
  MAFIA: "마피아 팀",
};

export function sortTimelineEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((left, right) => left.seq - right.seq);
}

export function getTimelineEventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function getWinnerTeamLabel(winnerTeam: string): string {
  return WINNER_TEAM_LABELS[winnerTeam] ?? winnerTeam;
}

export function extractWinnerTeam(event: TimelineEvent | undefined): string | null {
  if (!event) {
    return null;
  }

  if (!isRecord(event.payload)) {
    return null;
  }

  return typeof event.payload.winnerTeam === "string" ? event.payload.winnerTeam : null;
}

export function parseTimelineResponse(value: unknown): TimelineResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const { gameId, events } = value;

  if (typeof gameId !== "string" || !Array.isArray(events)) {
    return null;
  }

  const parsedEvents: TimelineEvent[] = [];

  for (const event of events) {
    if (!isRecord(event)) {
      return null;
    }

    const {
      id,
      seq,
      type,
      turn,
      phase,
      actorUserId,
      payload,
      visibilityDuringGame,
      visibilityAfterGame,
      requestId,
      createdAt,
      gameId: eventGameId,
    } = event;

    if (
      typeof id !== "string" ||
      typeof eventGameId !== "string" ||
      typeof seq !== "number" ||
      typeof type !== "string" ||
      typeof turn !== "number" ||
      typeof phase !== "string" ||
      !isNullableString(actorUserId) ||
      typeof visibilityDuringGame !== "string" ||
      typeof visibilityAfterGame !== "string" ||
      !isNullableString(requestId) ||
      typeof createdAt !== "string"
    ) {
      return null;
    }

    parsedEvents.push({
      id,
      gameId: eventGameId,
      seq,
      type,
      turn,
      phase,
      actorUserId,
      payload,
      visibilityDuringGame,
      visibilityAfterGame,
      requestId,
      createdAt,
    });
  }

  return {
    gameId,
    events: parsedEvents,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
