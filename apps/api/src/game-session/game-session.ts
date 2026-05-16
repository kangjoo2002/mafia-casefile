import type {
  ConnectionStatus,
  GamePhase,
  PlayerStatus,
  Role,
} from '@mafia-casefile/shared';

export interface GameSessionPlayer {
  userId: string;
  nickname: string;
  role: Role;
  status: PlayerStatus;
  connectionStatus: ConnectionStatus;
  lastSeenAt: Date;
}

export interface GameSessionNightActions {
  mafiaTarget?: string | null;
  doctorTarget?: string | null;
  policeTarget?: string | null;
}

export interface GameSession {
  gameId: string;
  roomId: string;
  phase: GamePhase;
  turn: number;
  version: number;
  hostUserId: string;
  players: GameSessionPlayer[];
  votes: Record<string, string>;
  nightActions: GameSessionNightActions;
  phaseEndsAt: Date | null;
  processedRequests: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GameSessionRepository {
  save(session: GameSession): Promise<GameSession>;
  findByGameId(gameId: string): Promise<GameSession | null>;
}

export const GAME_SESSION_REPOSITORY = 'GAME_SESSION_REPOSITORY';
