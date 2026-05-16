import type { Role } from "./game";
import type { GamePhase } from "./game";

export interface SocketUser {
  id: string;
  email: string;
}

export interface PongEvent {
  type: "pong";
  timestamp: string;
}

export interface WhoamiEvent {
  id: string;
  email: string;
}

export interface GameStartedEvent {
  type: "game:started";
  gameId: string;
  startedByUserId: string;
  startedAt: string;
}

export interface RoleAssignedEvent {
  type: "role:assigned";
  gameId: string;
  userId: string;
  role: Role;
}

export interface PhaseChangedEvent {
  type: "phase:changed";
  gameId: string;
  fromPhase: GamePhase;
  toPhase: GamePhase;
  turn: number;
  requestedByUserId: string;
  changedAt: string;
}
