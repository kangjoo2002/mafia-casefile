import type {
  AvailableAction,
  ChatChannel,
  ChatMessageEvent,
  ConnectionStatus,
  GamePhase,
  PlayerStatus,
  ReconnectStateEvent,
  Role,
} from "@mafia-casefile/shared";

export type RoomStatus = "WAITING" | "IN_PROGRESS" | "FINISHED";

export interface DemoIdentity {
  userId: string;
  email: string;
  nickname: string;
  token: string;
}

export interface RoomParticipantView {
  userId: string;
  nickname: string;
  isReady: boolean;
}

export interface RoomView {
  roomId: string;
  hostUserId: string;
  name: string;
  status: RoomStatus;
  maxPlayers: number;
  playerCount: number;
  participants: RoomParticipantView[];
}

export interface GameSessionPlayerView {
  userId: string;
  nickname: string;
  role: Role | string;
  status: PlayerStatus | string;
  connectionStatus: ConnectionStatus | string;
}

export interface GameSessionView {
  gameId: string;
  phase: GamePhase | string;
  turn: number;
  players: GameSessionPlayerView[];
}

export interface ChatMessageView extends ChatMessageEvent {
  id: string;
}

export interface EventLogEntry {
  id: string;
  timestamp: string;
  title: string;
  kind: "info" | "success" | "error";
  payload: unknown;
}

export interface PlaySocketEventLog {
  eventName: string;
  payload: unknown;
}

export type {
  AvailableAction,
  ChatChannel,
  ReconnectStateEvent,
};
