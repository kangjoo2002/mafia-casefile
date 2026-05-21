import type { CommandRejectReason } from '@mafia-casefile/shared';

export const COMMAND_REJECT_REASONS = [
  'INVALID_COMMAND_ENVELOPE',
  'UNAUTHORIZED',
  'DUPLICATE_REQUEST_IN_PROGRESS',
  'GAME_LOCK_BUSY',
  'INVALID_ROOM_COMMAND',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_NOT_JOINABLE',
  'ROOM_COMMAND_FAILED',
  'PARTICIPANT_NOT_FOUND',
  'NOT_ROOM_HOST',
  'ROOM_TOO_SMALL',
  'ROOM_NOT_READY',
  'ROOM_NOT_STARTABLE',
  'GAME_SESSION_NOT_FOUND',
  'GAME_NOT_IN_PROGRESS',
  'GAME_ALREADY_FINISHED',
  'GAME_NOT_IN_VOTING',
  'GAME_NOT_IN_NIGHT',
  'PLAYER_NOT_IN_GAME',
  'PLAYER_NOT_ALIVE',
  'PLAYER_NOT_DEAD',
  'TARGET_PLAYER_NOT_FOUND',
  'TARGET_PLAYER_NOT_ALIVE',
  'TARGET_SELF_NOT_ALLOWED',
  'VOTE_ALREADY_CAST',
  'ROLE_NOT_ALLOWED',
  'CHAT_NOT_ALLOWED_IN_CURRENT_PHASE',
  'INVALID_CHAT_COMMAND',
  'INVALID_CHAT_CHANNEL',
  'INVALID_CHAT_MESSAGE',
  'CHAT_MESSAGE_TOO_LONG',
] as const satisfies readonly CommandRejectReason[];

export const COMMAND_REJECT_MESSAGES: Record<CommandRejectReason, string> = {
  INVALID_COMMAND_ENVELOPE: 'Command envelope is invalid.',
  UNAUTHORIZED: 'Socket user is missing.',
  DUPLICATE_REQUEST_IN_PROGRESS: 'Duplicate request is already processing.',
  GAME_LOCK_BUSY: 'Game command is busy. Retry later.',
  INVALID_ROOM_COMMAND: 'Room command payload is invalid.',
  ROOM_NOT_FOUND: 'room not found',
  ROOM_FULL: 'room is full',
  ROOM_NOT_JOINABLE: 'room is not joinable',
  ROOM_COMMAND_FAILED: 'Room command failed.',
  PARTICIPANT_NOT_FOUND: 'participant not found',
  NOT_ROOM_HOST: 'only host can start game',
  ROOM_TOO_SMALL: 'room needs at least 4 players',
  ROOM_NOT_READY: 'not all participants are ready',
  ROOM_NOT_STARTABLE: 'room is not startable',
  GAME_SESSION_NOT_FOUND: 'game session not found',
  GAME_NOT_IN_PROGRESS: 'game session is not in progress',
  GAME_ALREADY_FINISHED: 'game is finished',
  GAME_NOT_IN_VOTING: 'votes are only allowed during VOTING',
  GAME_NOT_IN_NIGHT: 'night actions are only allowed during NIGHT',
  PLAYER_NOT_IN_GAME: 'player not found in game session',
  PLAYER_NOT_ALIVE: 'player is not alive',
  PLAYER_NOT_DEAD: 'player is not dead',
  TARGET_PLAYER_NOT_FOUND: 'target player not found',
  TARGET_PLAYER_NOT_ALIVE: 'target player is not alive',
  TARGET_SELF_NOT_ALLOWED: 'target self is not allowed',
  VOTE_ALREADY_CAST: 'vote already cast',
  ROLE_NOT_ALLOWED: 'role not allowed',
  CHAT_NOT_ALLOWED_IN_CURRENT_PHASE: 'chat is not allowed in current phase',
  INVALID_CHAT_COMMAND: 'Chat command payload is invalid.',
  INVALID_CHAT_CHANNEL: 'chat channel is invalid.',
  INVALID_CHAT_MESSAGE: 'chat message is required',
  CHAT_MESSAGE_TOO_LONG: 'chat message is too long',
};

export function isCommandRejectReason(
  value: unknown,
): value is CommandRejectReason {
  return (
    typeof value === 'string' &&
    (COMMAND_REJECT_REASONS as readonly string[]).includes(value)
  );
}

export function getCommandRejectMessage(reason: CommandRejectReason): string {
  return COMMAND_REJECT_MESSAGES[reason];
}

export function normalizeCommandRejectReason(
  value: unknown,
): CommandRejectReason {
  return isCommandRejectReason(value) ? value : 'ROOM_COMMAND_FAILED';
}
