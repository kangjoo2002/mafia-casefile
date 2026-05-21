import type { AvailableAction } from "@mafia-casefile/shared";
import type { RoomView } from "../../../lib/play-types";

export function isTargetAction(action: AvailableAction) {
  return (
    action.type === "CAST_VOTE" ||
    action.type === "SELECT_MAFIA_TARGET" ||
    action.type === "SELECT_DOCTOR_TARGET" ||
    action.type === "SELECT_POLICE_TARGET"
  );
}

export function getActionVerb(type: AvailableAction["type"]) {
  switch (type) {
    case "CAST_VOTE":
      return "투표하기";
    case "SELECT_MAFIA_TARGET":
      return "습격";
    case "SELECT_DOCTOR_TARGET":
      return "보호";
    case "SELECT_POLICE_TARGET":
      return "경찰 조사";
    default:
      return "선택";
  }
}

export function getPhaseGuide(input: {
  phase: string;
  role: string;
  status: string;
  targetAction: AvailableAction | null;
  canAdvancePhase: boolean;
}) {
  if (input.status === "DEAD") {
    return {
      title: "당신은 사망했습니다",
      description: "유령 채팅으로 남은 플레이어를 지켜보세요.",
    };
  }

  if (input.targetAction) {
    return {
      title: getActionGuideTitle(input.targetAction.type),
      description: "아래 플레이어 카드에서 대상을 직접 선택하세요.",
    };
  }

  if (input.phase === "NIGHT") {
    return {
      title: "밤입니다",
      description:
        input.role === "MAFIA"
          ? "마피아끼리 대화하고 습격할 대상을 고르세요."
          : "조용히 밤이 지나가기를 기다리세요.",
    };
  }

  if (input.phase === "DAY_DISCUSSION") {
    return {
      title: "낮 토론 시간입니다",
      description: "채팅으로 의심되는 사람을 이야기하세요.",
    };
  }

  if (input.phase === "VOTING") {
    return {
      title: "투표 시간입니다",
      description: "처형할 사람을 한 명 고르세요.",
    };
  }

  if (input.phase === "RESULT" || input.phase === "FINISHED") {
    return {
      title: "사건 결과를 확인하세요",
      description: "게임이 끝나면 사건 기록에서 전체 흐름을 복기할 수 있습니다.",
    };
  }

  return {
    title: input.canAdvancePhase
      ? "다음 단계로 진행할 수 있습니다"
      : "게임 진행을 기다리는 중입니다",
    description: input.canAdvancePhase
      ? "방장은 다음 단계 버튼으로 게임을 진행합니다."
      : "다른 플레이어의 행동을 기다리고 있습니다.",
  };
}

export function buildLobbySeats(room: RoomView | null, currentUserId: string) {
  const maxPlayers = room?.maxPlayers ?? 4;
  const participants = room?.participants ?? [];
  const current = participants.find(
    (participant) => participant.userId === currentUserId,
  );
  const others = participants.filter(
    (participant) => participant.userId !== currentUserId,
  );
  const ordered = current ? [current, ...others] : participants;

  return Array.from({ length: maxPlayers }, (_, index) => ordered[index] ?? null);
}

function getActionGuideTitle(type: AvailableAction["type"]) {
  switch (type) {
    case "CAST_VOTE":
      return "처형할 사람을 고르세요";
    case "SELECT_MAFIA_TARGET":
      return "습격할 사람을 고르세요";
    case "SELECT_DOCTOR_TARGET":
      return "보호할 사람을 고르세요";
    case "SELECT_POLICE_TARGET":
      return "조사할 사람을 고르세요";
    default:
      return "행동할 대상을 고르세요";
  }
}
