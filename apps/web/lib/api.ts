import type { RoomStatus, RoomView } from "./play-types";

const DEFAULT_API_BASE_URL = "http://localhost:3001";

export function getApiBaseUrl() {
  return normalizeBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  );
}

export async function createDemoToken(input: {
  userId: string;
  email: string;
}): Promise<string> {
  const response = await fetch("/api/demo-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, "토큰 발급에 실패했습니다."));
  }

  if (!isRecord(data) || typeof data.token !== "string") {
    throw new Error("토큰 응답 형식이 올바르지 않습니다.");
  }

  return data.token;
}

export async function createRoom(input: {
  hostUserId: string;
  name: string;
}): Promise<RoomView> {
  const response = await fetch(`${getApiBaseUrl()}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, "방 생성에 실패했습니다."));
  }

  return parseRoomResponse(data);
}

export async function getRoom(roomId: string): Promise<RoomView> {
  const response = await fetch(
    `${getApiBaseUrl()}/rooms/${encodeURIComponent(roomId)}`,
    {
      cache: "no-store",
    },
  );

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, "방 조회에 실패했습니다."));
  }

  return parseRoomResponse(data);
}

async function readJson(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return text.length > 0 ? { message: text } : null;
  }

  return response.json();
}

function extractErrorMessage(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }

  return fallback;
}

function parseRoomResponse(value: unknown): RoomView {
  if (!isRecord(value) || !isRecord(value.room)) {
    throw new Error("방 응답 형식이 올바르지 않습니다.");
  }

  const room = value.room;

  if (
    typeof room.roomId !== "string" ||
    typeof room.hostUserId !== "string" ||
    typeof room.name !== "string" ||
    typeof room.status !== "string" ||
    typeof room.maxPlayers !== "number" ||
    typeof room.playerCount !== "number" ||
    !Array.isArray(room.participants)
  ) {
    throw new Error("방 응답 형식이 올바르지 않습니다.");
  }

  return {
    roomId: room.roomId,
    hostUserId: room.hostUserId,
    name: room.name,
    status: room.status as RoomStatus,
    maxPlayers: room.maxPlayers,
    playerCount: room.playerCount,
    participants: room.participants
      .filter((participant: unknown) => isRecord(participant))
      .map((participant: Record<string, unknown>) => {
        if (
          typeof participant.userId !== "string" ||
          typeof participant.nickname !== "string" ||
          typeof participant.isReady !== "boolean"
        ) {
          throw new Error("방 참가자 응답 형식이 올바르지 않습니다.");
        }

        return {
          userId: participant.userId,
          nickname: participant.nickname,
          isReady: participant.isReady,
        };
      }),
  };
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
