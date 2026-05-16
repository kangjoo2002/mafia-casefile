import type { GamePhase } from "./game";

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
  reason: string;
  message: string;
}

export interface CommandAcceptedEvent {
  type: "COMMAND_ACCEPTED";
  requestId: string;
  receivedType: string;
}
