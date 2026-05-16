import type {
  CommandEnvelope,
  CommandRejectedEvent,
} from '@mafia-casefile/shared';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildRejectedEvent(requestId: string | undefined): CommandRejectedEvent {
  return {
    type: 'COMMAND_REJECTED',
    requestId,
    reason: 'INVALID_COMMAND_ENVELOPE',
    message: 'Command envelope is invalid.',
  };
}

export function parseCommandEnvelope(
  value: unknown,
): CommandEnvelope | CommandRejectedEvent {
  if (!isObject(value)) {
    return buildRejectedEvent(undefined);
  }

  const requestId =
    typeof value.requestId === 'string' ? value.requestId : undefined;

  if (
    !isNonEmptyString(value.type) ||
    !isNonEmptyString(value.requestId) ||
    !isNonEmptyString(value.gameId) ||
    !('payload' in value)
  ) {
    return buildRejectedEvent(requestId);
  }

  return {
    type: value.type,
    requestId: value.requestId,
    gameId: value.gameId,
    payload: value.payload,
  };
}
