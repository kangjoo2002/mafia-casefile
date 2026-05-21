import type { GamePhase } from "./game";

export type CommandRejectReason =
  | "INVALID_COMMAND_ENVELOPE"
  | "UNAUTHORIZED"
  | "DUPLICATE_REQUEST_IN_PROGRESS"
  | "GAME_LOCK_BUSY"
  | "INVALID_ROOM_COMMAND"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_NOT_JOINABLE"
  | "ROOM_COMMAND_FAILED"
  | "PARTICIPANT_NOT_FOUND"
  | "NOT_ROOM_HOST"
  | "ROOM_TOO_SMALL"
  | "ROOM_NOT_READY"
  | "ROOM_NOT_STARTABLE"
  | "GAME_SESSION_NOT_FOUND"
  | "GAME_NOT_IN_PROGRESS"
  | "GAME_ALREADY_FINISHED"
  | "GAME_NOT_IN_VOTING"
  | "GAME_NOT_IN_NIGHT"
  | "PLAYER_NOT_IN_GAME"
  | "PLAYER_NOT_ALIVE"
  | "PLAYER_NOT_DEAD"
  | "TARGET_PLAYER_NOT_FOUND"
  | "TARGET_PLAYER_NOT_ALIVE"
  | "TARGET_SELF_NOT_ALLOWED"
  | "VOTE_ALREADY_CAST"
  | "ROLE_NOT_ALLOWED"
  | "CHAT_NOT_ALLOWED_IN_CURRENT_PHASE"
  | "INVALID_CHAT_COMMAND"
  | "INVALID_CHAT_CHANNEL"
  | "INVALID_CHAT_MESSAGE"
  | "CHAT_MESSAGE_TOO_LONG";

export interface CommandEnvelope<
  TType extends string = string,
  TPayload = unknown,
> {
  type: TType;
  requestId: string;
  gameId: string;
  payload: TPayload;
}

export type EventVisibility =
  | "PUBLIC"
  | "PRIVATE"
  | "MAFIA_ONLY"
  | "GHOST_ONLY"
  | "SYSTEM_ONLY";

export interface EventEnvelope<
  TType extends string = string,
  TPayload = unknown,
> {
  type: TType;
  eventId?: string;
  gameId?: string;
  seq?: number;
  turn?: number;
  phase?: GamePhase;
  visibility?: EventVisibility;
  payload: TPayload;
  occurredAt: string;
}

export interface CommandRejectedEvent {
  type: "COMMAND_REJECTED";
  requestId?: string;
  reason: CommandRejectReason;
  message: string;
}

export interface CommandAcceptedEvent {
  type: "COMMAND_ACCEPTED";
  requestId: string;
  receivedType: string;
}
