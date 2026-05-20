import { Inject, Injectable } from '@nestjs/common';
import type {
  ChatChannel,
  ChatMessageEvent,
  ReconnectChatChannelSnapshot,
  ReconnectStateEvent,
  PlayerStatus,
  Role,
} from '@mafia-casefile/shared';
import { ChatMessageCacheService } from './chat-message-cache.service';
import { AvailableActionsService } from './available-actions.service';
import { GameSessionService } from '../game-session/game-session.service';

@Injectable()
export class ReconnectStateService {
  constructor(
    @Inject(GameSessionService)
    private readonly gameSessionService: GameSessionService,
    @Inject(AvailableActionsService)
    private readonly availableActionsService: AvailableActionsService,
    @Inject(ChatMessageCacheService)
    private readonly chatMessageCacheService: ChatMessageCacheService,
  ) {}

  async buildReconnectState(input: {
    userId: string;
    previousRoomId: string | null;
  }): Promise<ReconnectStateEvent> {
    if (!input.previousRoomId) {
      return {
        type: 'reconnect:state',
        userId: input.userId,
        restored: false,
        roomId: null,
        gameId: null,
        reason: 'NO_ROOM',
        session: null,
        player: null,
        recentChats: [],
        availableActions: [],
      };
    }

    const session = await this.gameSessionService.findByGameId(
      input.previousRoomId,
    );

    if (!session) {
      return {
        type: 'reconnect:state',
        userId: input.userId,
        restored: false,
        roomId: input.previousRoomId,
        gameId: input.previousRoomId,
        reason: 'GAME_SESSION_NOT_FOUND',
        session: null,
        player: null,
        recentChats: [],
        availableActions: [],
      };
    }

    const player = session.players.find(
      (current) => current.userId === input.userId,
    );

    if (!player) {
      return {
        type: 'reconnect:state',
        userId: input.userId,
        restored: false,
        roomId: input.previousRoomId,
        gameId: input.previousRoomId,
        reason: 'PLAYER_NOT_IN_GAME',
        session: structuredClone(session),
        player: null,
        recentChats: [],
        availableActions: [],
      };
    }

    const recentChats = await this.loadRecentChats(session.gameId, player.role, player.status);

    return {
      type: 'reconnect:state',
      userId: input.userId,
      restored: true,
      roomId: input.previousRoomId,
      gameId: input.previousRoomId,
      reason: 'RESTORED',
      session: structuredClone(session),
      player: structuredClone(player),
      recentChats,
      availableActions: this.availableActionsService.buildForPlayer({
        session,
        userId: input.userId,
      }),
    };
  }

  private async loadRecentChats(
    gameId: string,
    role: Role,
    status: PlayerStatus,
  ): Promise<ReconnectChatChannelSnapshot[]> {
    const channels: ChatChannel[] = ['LOBBY', 'DAY'];

    if (role === 'MAFIA') {
      channels.push('MAFIA');
    }

    if (status === 'DEAD') {
      channels.push('GHOST');
    }

    const snapshots = await Promise.all(
      channels.map(async (channel) => ({
        channel,
        messages: (await this.chatMessageCacheService.getRecent({
          gameId,
          channel,
        })) as ChatMessageEvent[],
      })),
    );

    return snapshots;
  }
}
