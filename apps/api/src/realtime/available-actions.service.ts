import { Injectable } from '@nestjs/common';
import type {
  AvailableAction,
} from '@mafia-casefile/shared';
import type { GameSession } from '../game-session/game-session';

@Injectable()
export class AvailableActionsService {
  buildForPlayer(input: {
    session: GameSession;
    userId: string;
  }): AvailableAction[] {
    const player = input.session.players.find(
      (current) => current.userId === input.userId,
    );

    if (!player) {
      return [];
    }

    if (player.connectionStatus === 'DISCONNECTED') {
      return [];
    }

    if (input.session.phase === 'FINISHED') {
      return [];
    }

    const actions: AvailableAction[] = [];
    const alivePlayerIds = input.session.players
      .filter((current) => current.status === 'ALIVE')
      .map((current) => current.userId);
    const otherAlivePlayerIds = alivePlayerIds.filter(
      (userId) => userId !== input.userId,
    );

    if (input.session.hostUserId === input.userId) {
      actions.push({ type: 'NEXT_PHASE' });
    }

    if (input.session.phase === 'VOTING' && player.status === 'ALIVE') {
      actions.push({
        type: 'CAST_VOTE',
        targetUserIds: alivePlayerIds,
      });
    }

    if (input.session.phase === 'NIGHT' && player.status === 'ALIVE') {
      if (player.role === 'MAFIA') {
        actions.push({
          type: 'SELECT_MAFIA_TARGET',
          targetUserIds: otherAlivePlayerIds,
        });
        actions.push({
          type: 'SEND_CHAT_MESSAGE',
          channel: 'MAFIA',
        });
      }

    if (player.role === 'DOCTOR') {
      actions.push({
        type: 'SELECT_DOCTOR_TARGET',
          targetUserIds: alivePlayerIds,
      });
    }

      if (player.role === 'POLICE') {
        actions.push({
          type: 'SELECT_POLICE_TARGET',
          targetUserIds: otherAlivePlayerIds,
        });
      }
    }

    if (input.session.phase === 'DAY_DISCUSSION' && player.status === 'ALIVE') {
      actions.push({
        type: 'SEND_CHAT_MESSAGE',
        channel: 'DAY',
      });
    }

    if (player.status === 'DEAD') {
      actions.push({
        type: 'SEND_CHAT_MESSAGE',
        channel: 'GHOST',
      });
    }

    return actions;
  }
}
