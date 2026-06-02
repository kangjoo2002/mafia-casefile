import type { Role } from "./game";
import type { GamePhase } from "./game";

export interface SocketUser {
  id: string;
  email: string;
}

export type ChatChannel = "LOBBY" | "DAY" | "MAFIA" | "GHOST" | "SYSTEM";

export type AvailableActionType =
  | "NEXT_PHASE"
  | "CAST_VOTE"
  | "SELECT_MAFIA_TARGET"
  | "SELECT_DOCTOR_TARGET"
  | "SELECT_POLICE_TARGET"
  | "SEND_CHAT_MESSAGE";

export interface AvailableAction {
  type: AvailableActionType;
  channel?: ChatChannel;
  targetUserIds?: string[];
}

export interface ChatMessageEvent {
  type: "chat:message";
  gameId: string;
  channel: ChatChannel;
  message: string;
  senderUserId: string | null;
  sentAt: string;
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
  phaseEndsAt: string | null;
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
  requestedByUserId: string | null;
  phaseEndsAt: string | null;
  changedAt: string;
}

export interface InvestigationResultEvent {
  type: "investigation:result";
  gameId: string;
  targetUserId: string;
  result: Role;
  investigatedAt: string;
}

export interface NightResolvedEvent {
  type: "night:resolved";
  gameId: string;
  turn: number;
  attackedUserId: string | null;
  protectedUserId: string | null;
  killedUserId: string | null;
  resolvedAt: string;
}

export interface VoteTallyEntry {
  targetUserId: string;
  count: number;
}

export interface VotingResolvedEvent {
  type: "voting:resolved";
  gameId: string;
  turn: number;
  executedUserId: string | null;
  voteResult: VoteTallyEntry[];
  resolvedAt: string;
}

export interface GameFinishedEvent {
  type: "game:finished";
  gameId: string;
  winnerTeam: "MAFIA" | "CITIZEN";
  reason: string;
  finishedAt: string;
}

export interface PlayerDisconnectedEvent {
  type: "player:disconnected";
  gameId: string;
  userId: string;
  disconnectedAt: string;
  gracePeriodSeconds: number;
}

export type ReconnectStateReason =
  | "RESTORED"
  | "NO_PREVIOUS_STATE"
  | "NO_ROOM"
  | "GAME_SESSION_NOT_FOUND"
  | "PLAYER_NOT_IN_GAME";

export interface ReconnectChatChannelSnapshot {
  channel: ChatChannel;
  messages: ChatMessageEvent[];
}

export interface ReconnectStateEvent {
  type: "reconnect:state";
  userId: string;
  serverInstanceId?: string;
  restored: boolean;
  roomId: string | null;
  gameId: string | null;
  reason: ReconnectStateReason;
  session: unknown | null;
  player: unknown | null;
  recentChats: ReconnectChatChannelSnapshot[];
  availableActions: AvailableAction[];
}
