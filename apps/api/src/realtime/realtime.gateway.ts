import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '../auth/jwt.service';
import { GameCommandService } from '../game-commands/game-command.service';
import type {
  GameCommandBroadcastEffect,
  GameCommandEffect,
  GameCommandPrivateEventEffect,
  GameCommandRejectedResult,
  GameCommandResult,
} from '../game-commands/game-command.types';
import { GameCommandLockService } from './game-command-lock.service';
import { ConnectionStateService } from './connection-state.service';
import { ChatMessageCacheService } from './chat-message-cache.service';
import { parseCommandEnvelope } from './command-envelope';
import { GameSessionService } from '../game-session/game-session.service';
import { RequestIdempotencyService } from './request-idempotency.service';
import { ReconnectStateService } from './reconnect-state.service';
import {
  normalizeCommandRejectReason,
} from '../game-commands/game-command.errors';
import { PersonalEventChannelService } from './personal-event-channel.service';
import {
  PhaseTimerService,
  type PhaseTimerEntry,
} from './phase-timer.service';
import { AuthenticatedSocket } from './socket-user';
import type {
  CommandAcceptedEvent,
  CommandRejectedEvent,
  ChatMessageEvent,
  PlayerDisconnectedEvent,
  PongEvent,
  ReconnectStateEvent,
  WhoamiEvent,
} from '@mafia-casefile/shared';

@WebSocketGateway({
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  },
})
@Injectable()
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly serverInstanceId = this.resolveServerInstanceId();
  private phaseTimerPoller: ReturnType<typeof setInterval> | null = null;
  private readonly phaseTimerWakeups = new Set<ReturnType<typeof setTimeout>>();
  private phaseTimerPollInProgress = false;

  @WebSocketServer()
  private server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(GameCommandService)
    private readonly gameCommandService: GameCommandService,
    @Inject(GameCommandLockService)
    private readonly gameCommandLockService: GameCommandLockService,
    @Inject(ConnectionStateService)
    private readonly connectionStateService: ConnectionStateService,
    @Inject(ChatMessageCacheService)
    private readonly chatMessageCacheService: ChatMessageCacheService,
    @Inject(GameSessionService)
    private readonly gameSessionService: GameSessionService,
    @Inject(RequestIdempotencyService)
    private readonly requestIdempotencyService: RequestIdempotencyService,
    @Inject(ReconnectStateService)
    private readonly reconnectStateService: ReconnectStateService,
    @Inject(PersonalEventChannelService)
    private readonly personalEventChannelService: PersonalEventChannelService,
    @Inject(PhaseTimerService)
    private readonly phaseTimerService: PhaseTimerService,
  ) {}

  onModuleDestroy() {
    if (this.phaseTimerPoller) {
      clearInterval(this.phaseTimerPoller);
      this.phaseTimerPoller = null;
    }

    for (const wakeup of this.phaseTimerWakeups) {
      clearTimeout(wakeup);
    }

    this.phaseTimerWakeups.clear();
  }

  afterInit(server: Server) {
    this.startPhaseTimerPoller();

    server.use((socket, next) => {
      const token = socket.handshake.auth?.token;

      if (typeof token !== 'string' || token.trim().length === 0) {
        next(new Error('Unauthorized'));
        return;
      }

      try {
        const payload = this.jwtService.verifyAccessToken(token);
        const authedSocket = socket as AuthenticatedSocket;
        authedSocket.data ??= {};
        authedSocket.data.user = {
          id: payload.sub,
          email: payload.email,
        };
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user;

    if (user) {
      let previousRoomId: string | null = null;

      try {
        const previousState = await this.connectionStateService.findByUserId(
          user.id,
        );
        previousRoomId = previousState?.roomId ?? null;
      } catch (error) {
        this.warnConnectionStateError(
          'load previous state',
          user.id,
          client.id,
          error,
        );
      }

      try {
        await this.personalEventChannelService.joinUserRoom(client, user.id);
      } catch (error) {
        this.warnConnectionStateError('join user room', user.id, client.id, error);
      }

      try {
        await this.connectionStateService.markConnected({
          userId: user.id,
          socketId: client.id,
        });
      } catch (error) {
        this.warnConnectionStateError('mark connected', user.id, client.id, error);
      }

      const fallbackReconnectState = previousRoomId
        ? this.buildNoPreviousReconnectState(user.id)
        : this.buildNoRoomReconnectState(user.id);

      let reconnectState: ReconnectStateEvent = fallbackReconnectState;

      if (previousRoomId) {
        try {
          await client.join(previousRoomId);
        } catch (error) {
          this.warnConnectionStateError(
            'join previous room',
            user.id,
            client.id,
            error,
          );
        }

        await this.persistRoomState(
          'set room',
          () =>
            this.connectionStateService.setRoom({
              userId: user.id,
              socketId: client.id,
              roomId: previousRoomId,
            }),
          user.id,
          client.id,
        );

        await this.markReconnectedPlayerWithLock(previousRoomId, user.id);

        try {
          reconnectState = await this.reconnectStateService.buildReconnectState({
            userId: user.id,
            previousRoomId,
          });
        } catch (error) {
          this.warnReconnectStateError(previousRoomId, user.id, error);
          reconnectState = fallbackReconnectState;
        }
      }

      this.personalEventChannelService.emitToSocket(
        client,
        'reconnect:state',
        this.withServerInstanceId(reconnectState),
      );
    }

    this.logger.log(`connected ${user?.id ?? authedClient.id}`);
  }

  async handleDisconnect(client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user;

    if (user) {
      await this.handleDisconnectedUser(client, user);
    }

    this.logger.log(`disconnected ${authedClient.data.user?.id ?? authedClient.id}`);
  }

  @SubscribeMessage('ping')
  handlePing(
    @MessageBody() _body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    const event: PongEvent = {
      type: 'pong',
      timestamp: new Date().toISOString(),
    };

    this.personalEventChannelService.emitToSocket(client, 'pong', event);
  }

  @SubscribeMessage('command')
  async handleCommand(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    const parsed = parseCommandEnvelope(body);

    if ('reason' in parsed) {
      const rejected: CommandRejectedEvent = parsed;
      this.personalEventChannelService.emitToSocket(
        client,
        'command:rejected',
        rejected,
      );
      return;
    }

    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user ?? null;

    if (!user) {
      await this.handleCommandWithoutIdempotency(client, parsed, user);
      return;
    }

    const idempotency = await this.beginRequestIdempotency(parsed, user);

    if (!idempotency) {
      await this.handleCommandWithoutIdempotency(client, parsed, user);
      return;
    }

    if (idempotency.status === 'DUPLICATE_PROCESSING') {
      this.emitRoomRejected(client, {
        type: 'COMMAND_REJECTED',
        requestId: parsed.requestId,
        reason: 'DUPLICATE_REQUEST_IN_PROGRESS',
        message: 'Duplicate request is already processing.',
      });
      return;
    }

    if (idempotency.status === 'DUPLICATE_COMPLETED') {
      this.emitCompletedRequest(client, idempotency.record, parsed.type);
      return;
    }

    await this.handleCommandWithIdempotency(client, parsed, user);
  }

  @SubscribeMessage('whoami')
  handleWhoami(@ConnectedSocket() client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const event = authedClient.data.user as WhoamiEvent | undefined;

    this.personalEventChannelService.emitToSocket(client, 'whoami', event);
  }

  private async applyCommandEffects(
    client: Socket,
    user: { id: string; email: string } | null,
    effects: GameCommandEffect[],
  ) {
    const cachedChatMessages = new Set<string>();

    for (const effect of effects) {
      if (effect.kind === 'join') {
        await client.join(effect.roomId);
        if (user) {
          await this.persistRoomState('set room', () =>
            this.connectionStateService.setRoom({
              userId: user.id,
              socketId: client.id,
              roomId: effect.roomId,
            }),
            user.id,
            client.id,
          );
        }
        continue;
      }

      if (effect.kind === 'leave') {
        await client.leave(effect.roomId);
        if (user) {
          await this.persistRoomState('clear room', () =>
            this.connectionStateService.clearRoom({
              userId: user.id,
              socketId: client.id,
              roomId: effect.roomId,
            }),
            user.id,
            client.id,
          );
        }
        continue;
      }

      if (effect.kind === 'broadcast') {
        this.emitBroadcast(effect);
        await this.schedulePhaseTimerFromEffect(effect);
        await this.cacheChatMessageEffect(effect, cachedChatMessages);
        continue;
      }

      this.emitPrivate(effect);
      await this.cacheChatMessageEffect(effect, cachedChatMessages);
    }
  }

  private async applySystemCommandEffects(effects: GameCommandEffect[]) {
    const cachedChatMessages = new Set<string>();

    for (const effect of effects) {
      if (effect.kind !== 'broadcast') {
        continue;
      }

      this.emitBroadcast(effect);
      await this.schedulePhaseTimerFromEffect(effect);
      await this.cacheChatMessageEffect(effect, cachedChatMessages);
    }
  }

  private async schedulePhaseTimerFromEffect(effect: GameCommandBroadcastEffect) {
    if (effect.eventName !== 'game:started' && effect.eventName !== 'phase:changed') {
      return;
    }

    if (
      !effect.payload ||
      typeof effect.payload !== 'object' ||
      Array.isArray(effect.payload)
    ) {
      return;
    }

    const payload = effect.payload as {
      gameId?: unknown;
      phaseEndsAt?: unknown;
    };

    if (
      typeof payload.gameId !== 'string' ||
      typeof payload.phaseEndsAt !== 'string'
    ) {
      await this.phaseTimerService.clearGame(effect.roomId);
      return;
    }

    await this.phaseTimerService.schedule({
      gameId: payload.gameId,
      phaseEndsAt: payload.phaseEndsAt,
    });
    this.schedulePhaseTimerWakeup(payload.phaseEndsAt);
  }

  private async pollDuePhaseTimers() {
    if (this.phaseTimerPollInProgress) {
      return;
    }

    this.phaseTimerPollInProgress = true;

    try {
      const entries = await this.phaseTimerService.listDue(
        Date.now(),
        this.resolvePhaseTimerDueLimit(),
      );

      await Promise.all(
        entries.map((entry) => this.advancePhaseFromTimer(entry)),
      );
    } catch (error) {
      this.logger.warn(`phase timer poll failed: ${this.formatError(error)}`);
    } finally {
      this.phaseTimerPollInProgress = false;
    }
  }

  private startPhaseTimerPoller() {
    if (this.phaseTimerPoller) {
      return;
    }

    this.phaseTimerPoller = setInterval(() => {
      void this.pollDuePhaseTimers();
    }, this.resolvePhaseTimerPollIntervalMs());
  }

  private schedulePhaseTimerWakeup(phaseEndsAt: string) {
    const targetMs = Date.parse(phaseEndsAt);

    if (!Number.isFinite(targetMs)) {
      return;
    }

    const wakeup = setTimeout(() => {
      this.phaseTimerWakeups.delete(wakeup);
      void this.pollDuePhaseTimers();
    }, Math.max(0, targetMs - Date.now()));

    this.phaseTimerWakeups.add(wakeup);
  }

  private async advancePhaseFromTimer(entry: PhaseTimerEntry) {
    const { gameId, phaseEndsAt } = entry;
    const session = await this.gameSessionService.findByGameId(gameId);

    if (
      !session ||
      session.phase === 'FINISHED' ||
      session.phaseEndsAt?.toISOString() !== phaseEndsAt
    ) {
      await this.phaseTimerService.complete(entry);
      return;
    }

    let lock: { gameId: string; token: string } | null = null;

    try {
      lock = await this.gameCommandLockService.acquire({ gameId });
    } catch (error) {
      this.warnGameCommandLockError('acquire timer', gameId, error);
      return;
    }

    if (!lock) {
      return;
    }

    try {
      const result = await this.gameCommandService.advancePhaseAutomatically(gameId);

      if (result.type === 'COMMAND_ACCEPTED') {
        await this.applySystemCommandEffects(result.effects);
        await this.phaseTimerService.complete(entry);
      } else {
        await this.phaseTimerService.complete(entry);
        this.logger.warn(
          `automatic phase advance rejected ${gameId}: ${result.reason}`,
        );
      }
    } finally {
      try {
        await this.gameCommandLockService.release(lock);
      } catch (error) {
        this.warnGameCommandLockError('release timer', gameId, error);
      }
    }
  }

  private resolvePhaseTimerPollIntervalMs() {
    const raw = process.env.PHASE_TIMER_POLL_INTERVAL_MS;

    if (!raw) {
      return 100;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 100;
  }

  private resolvePhaseTimerDueLimit() {
    const raw = process.env.PHASE_TIMER_DUE_LIMIT;

    if (!raw) {
      return 100;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 100;
  }

  private async handleCommandWithoutIdempotency(
    client: Socket,
    parsed: {
      requestId: string;
      gameId: string;
      type: string;
      payload: unknown;
    },
    user: { id: string; email: string } | null,
  ) {
    const result = await this.gameCommandService.handleCommand(parsed, user);

    if (result.type === 'COMMAND_REJECTED') {
      this.emitRoomRejected(client, result);
      return;
    }

    await this.applyCommandEffects(client, user, result.effects);
    this.emitAccepted(client, result.requestId, result.receivedType);
  }

  private async handleCommandWithIdempotency(
    client: Socket,
    parsed: {
      requestId: string;
      gameId: string;
      type: string;
      payload: unknown;
    },
    user: { id: string; email: string },
  ) {
    let lock: { gameId: string; token: string } | null;

    try {
      lock = await this.gameCommandLockService.acquire({
        gameId: parsed.gameId,
      });
    } catch (error) {
      this.warnGameCommandLockError('acquire', parsed.gameId, error);
      await this.executeCommandWithCompletion(client, parsed, user);
      return;
    }

    if (!lock) {
      const rejected: GameCommandRejectedResult = {
        type: 'COMMAND_REJECTED' as const,
        requestId: parsed.requestId,
        reason: 'GAME_LOCK_BUSY',
        message: 'Game command is busy. Retry later.',
      };

      this.emitRoomRejected(client, rejected);
      await this.completeRequestRejected(parsed, user, rejected);
      return;
    }

    try {
      await this.executeCommandWithCompletion(client, parsed, user);
    } finally {
      try {
        await this.gameCommandLockService.release(lock);
      } catch (error) {
        this.warnGameCommandLockError('release', parsed.gameId, error);
      }
    }
  }

  private async handleDisconnectedUser(
    client: Socket,
    user: { id: string; email: string },
  ) {
    let state: Awaited<ReturnType<ConnectionStateService['markDisconnected']>> | null = null;

    try {
      state = await this.connectionStateService.markDisconnected({
        userId: user.id,
        socketId: client.id,
      });
    } catch (error) {
      this.warnConnectionStateError('mark disconnected', user.id, client.id, error);
      return;
    }

    if (state.socketId !== client.id) {
      return;
    }

    if (!state.roomId) {
      return;
    }

    let lock: { gameId: string; token: string } | null = null;

    try {
      lock = await this.gameCommandLockService.acquire({
        gameId: state.roomId,
      });
    } catch (error) {
      this.warnGameCommandLockError('acquire', state.roomId, error);
      return;
    }

    if (!lock) {
      this.warnGameCommandLockError(
        'acquire',
        state.roomId,
        new Error('lock busy'),
      );
      return;
    }

    try {
      const disconnectedAt = new Date(
        state.disconnectedAt ?? new Date().toISOString(),
      );

      await this.gameSessionService.markPlayerDisconnected({
        gameId: state.roomId,
        userId: user.id,
        disconnectedAt,
      });

      const event: PlayerDisconnectedEvent = {
        type: 'player:disconnected',
        gameId: state.roomId,
        userId: user.id,
        disconnectedAt: disconnectedAt.toISOString(),
        gracePeriodSeconds: this.resolveDisconnectGracePeriodSeconds(),
      };

      this.server.to(state.roomId).emit('player:disconnected', event);
    } catch (error) {
      this.warnGameSessionDisconnectError(state.roomId, user.id, error);
    } finally {
      try {
        await this.gameCommandLockService.release(lock);
      } catch (error) {
        this.warnGameCommandLockError('release', state.roomId, error);
      }
    }
  }

  private async markReconnectedPlayerWithLock(
    gameId: string,
    userId: string,
  ) {
    let lock: { gameId: string; token: string } | null = null;

    try {
      lock = await this.gameCommandLockService.acquire({ gameId });
    } catch (error) {
      this.warnGameCommandLockError('acquire', gameId, error);
      return;
    }

    if (!lock) {
      this.warnGameCommandLockError('acquire', gameId, new Error('lock busy'));
      return;
    }

    try {
      try {
        await this.gameSessionService.markPlayerConnected({
          gameId,
          userId,
        });
      } catch (error) {
        this.warnGameSessionReconnectError(gameId, userId, error);
      }
    } finally {
      try {
        await this.gameCommandLockService.release(lock);
      } catch (error) {
        this.warnGameCommandLockError('release', gameId, error);
      }
    }
  }

  private async executeCommandWithCompletion(
    client: Socket,
    parsed: {
      requestId: string;
      gameId: string;
      type: string;
      payload: unknown;
    },
    user: { id: string; email: string },
  ) {
    const result = await this.gameCommandService.handleCommand(parsed, user);

    if (result.type === 'COMMAND_REJECTED') {
      this.emitRoomRejected(client, result);
      await this.completeRequestRejected(parsed, user, result);
      return;
    }

    await this.applyCommandEffects(client, user, result.effects);
    this.emitAccepted(client, result.requestId, result.receivedType);
    await this.completeRequestAccepted(parsed, user, result.receivedType);
  }

  private emitBroadcast(effect: GameCommandBroadcastEffect) {
    this.server.to(effect.roomId).emit(effect.eventName, effect.payload);
  }

  private emitPrivate(effect: GameCommandPrivateEventEffect) {
    this.personalEventChannelService.emitToUser(
      this.server,
      effect.userId,
      effect.eventName,
      effect.payload,
    );
  }

  private async cacheChatMessageEffect(
    effect: GameCommandBroadcastEffect | GameCommandPrivateEventEffect,
    seen: Set<string>,
  ) {
    if (effect.eventName !== 'chat:message') {
      return;
    }

    if (!this.isChatMessageEvent(effect.payload)) {
      return;
    }

    const cacheKey = `${effect.payload.gameId}:${effect.payload.channel}:${effect.payload.senderUserId ?? ''}:${effect.payload.sentAt}:${effect.payload.message}`;

    if (seen.has(cacheKey)) {
      return;
    }

    seen.add(cacheKey);

    try {
      await this.chatMessageCacheService.append(effect.payload);
    } catch (error) {
      this.warnChatCacheError(effect.payload.gameId, effect.payload.channel, error);
    }
  }

  private isChatMessageEvent(payload: unknown): payload is ChatMessageEvent {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    const event = payload as Partial<ChatMessageEvent>;

    return (
      event.type === 'chat:message' &&
      typeof event.gameId === 'string' &&
      typeof event.channel === 'string' &&
      typeof event.message === 'string' &&
      (typeof event.senderUserId === 'string' || event.senderUserId === null) &&
      typeof event.sentAt === 'string'
    );
  }

  private emitAccepted(client: Socket, requestId: string, receivedType: string) {
    const accepted: CommandAcceptedEvent = {
      type: 'COMMAND_ACCEPTED',
      requestId,
      receivedType,
    };

    this.personalEventChannelService.emitToSocket(
      client,
      'command:accepted',
      accepted,
    );
  }

  private emitRoomRejected(client: Socket, result: GameCommandRejectedResult) {
    const rejected: CommandRejectedEvent = {
      type: 'COMMAND_REJECTED',
      requestId: result.requestId,
      reason: result.reason,
      message: result.message,
    };

    this.personalEventChannelService.emitToSocket(
      client,
      'command:rejected',
      rejected,
    );
  }

  private emitCompletedRequest(
    client: Socket,
    record: {
      requestId: string;
      resultType?: 'COMMAND_ACCEPTED' | 'COMMAND_REJECTED';
      reason?: string;
      message?: string;
      receivedType?: string;
    },
    receivedType: string,
  ) {
    if (record.resultType === 'COMMAND_ACCEPTED') {
      this.emitAccepted(client, record.requestId, record.receivedType ?? receivedType);
      return;
    }

    this.emitRoomRejected(client, {
      type: 'COMMAND_REJECTED',
      requestId: record.requestId,
      reason: normalizeCommandRejectReason(record.reason),
      message: record.message ?? 'Command failed.',
    });
  }

  private async beginRequestIdempotency(
    parsed: {
      requestId: string;
      gameId: string;
      type: string;
    },
    user: { id: string; email: string },
  ) {
    try {
      return await this.requestIdempotencyService.begin({
        gameId: parsed.gameId,
        userId: user.id,
        requestId: parsed.requestId,
        commandType: parsed.type,
      });
    } catch (error) {
      this.warnIdempotencyError('begin', user.id, parsed.gameId, parsed.requestId, error);
      return null;
    }
  }

  private async completeRequestAccepted(
    parsed: {
      requestId: string;
      gameId: string;
      type: string;
    },
    user: { id: string; email: string },
    receivedType: string,
  ) {
    try {
      await this.requestIdempotencyService.completeAccepted({
        gameId: parsed.gameId,
        userId: user.id,
        requestId: parsed.requestId,
        commandType: parsed.type,
        receivedType,
      });
    } catch (error) {
      this.warnIdempotencyError(
        'complete accepted',
        user.id,
        parsed.gameId,
        parsed.requestId,
        error,
      );
    }
  }

  private async completeRequestRejected(
    parsed: {
      requestId: string;
      gameId: string;
      type: string;
    },
    user: { id: string; email: string },
    result: GameCommandRejectedResult,
  ) {
    try {
      await this.requestIdempotencyService.completeRejected({
        gameId: parsed.gameId,
        userId: user.id,
        requestId: parsed.requestId,
        commandType: parsed.type,
        reason: result.reason,
        message: result.message,
      });
    } catch (error) {
      this.warnIdempotencyError(
        'complete rejected',
        user.id,
        parsed.gameId,
        parsed.requestId,
        error,
      );
    }
  }

  private warnIdempotencyError(
    action: string,
    userId: string,
    gameId: string,
    requestId: string,
    error: unknown,
  ) {
    const message = this.formatError(error);
    this.logger.warn(
      `failed to ${action} idempotency for user ${userId}, game ${gameId}, request ${requestId}: ${message}`,
    );
  }

  private warnGameCommandLockError(action: string, gameId: string, error: unknown) {
    const message = this.formatError(error);
    this.logger.warn(`failed to ${action} game command lock for game ${gameId}: ${message}`);
  }

  private warnChatCacheError(gameId: string, channel: string, error: unknown) {
    const message = this.formatError(error);
    this.logger.warn(`failed to cache chat message for game ${gameId}, channel ${channel}: ${message}`);
  }

  private resolveDisconnectGracePeriodSeconds() {
    const raw = process.env.DISCONNECT_GRACE_PERIOD_SECONDS;

    if (!raw) {
      return 120;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 120;
  }

  private warnGameSessionDisconnectError(gameId: string, userId: string, error: unknown) {
    const message = this.formatError(error);
    this.logger.warn(`failed to mark player disconnected for game ${gameId}, user ${userId}: ${message}`);
  }

  private warnGameSessionReconnectError(gameId: string, userId: string, error: unknown) {
    const message = this.formatError(error);
    this.logger.warn(`failed to mark player connected for game ${gameId}, user ${userId}: ${message}`);
  }

  private warnReconnectStateError(gameId: string, userId: string, error: unknown) {
    const message = this.formatError(error);
    this.logger.warn(`failed to build reconnect state for game ${gameId}, user ${userId}: ${message}`);
  }

  private formatError(error: unknown) {
    return error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown error';
  }

  private withServerInstanceId(
    event: ReconnectStateEvent,
  ): ReconnectStateEvent {
    return {
      ...event,
      serverInstanceId: this.serverInstanceId,
    };
  }

  private resolveServerInstanceId() {
    const raw = process.env.SERVER_INSTANCE_ID ?? 'api-local';
    const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
    return normalized.length > 0 ? normalized.slice(0, 40) : 'api-local';
  }

  private buildNoRoomReconnectState(userId: string): ReconnectStateEvent {
    return {
      type: 'reconnect:state',
      userId,
      serverInstanceId: this.serverInstanceId,
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

  private buildNoPreviousReconnectState(userId: string): ReconnectStateEvent {
    return {
      type: 'reconnect:state',
      userId,
      serverInstanceId: this.serverInstanceId,
      restored: false,
      roomId: null,
      gameId: null,
      reason: 'NO_PREVIOUS_STATE',
      session: null,
      player: null,
      recentChats: [],
      availableActions: [],
    };
  }

  private async persistRoomState(
    action: 'set room' | 'clear room',
    persist: () => Promise<unknown>,
    userId: string,
    socketId: string,
  ) {
    try {
      await persist();
    } catch (error) {
      this.warnConnectionStateError(action, userId, socketId, error);
    }
  }

  private warnConnectionStateError(
    action: string,
    userId: string,
    socketId: string,
    error: unknown,
  ) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
    this.logger.warn(
      `failed to ${action} for user ${userId} on socket ${socketId}: ${message}`,
    );
  }
}
