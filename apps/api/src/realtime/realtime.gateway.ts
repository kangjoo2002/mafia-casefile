import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { ConnectionStateService } from './connection-state.service';
import { parseCommandEnvelope } from './command-envelope';
import { AuthenticatedSocket } from './socket-user';
import type {
  CommandAcceptedEvent,
  CommandRejectedEvent,
  PongEvent,
  WhoamiEvent,
} from '@mafia-casefile/shared';

@WebSocketGateway({
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  },
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(GameCommandService)
    private readonly gameCommandService: GameCommandService,
    @Inject(ConnectionStateService)
    private readonly connectionStateService: ConnectionStateService,
  ) {}

  afterInit(server: Server) {
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

  handleConnection(client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user;

    if (user) {
      void client.join(`user:${user.id}`);
      void this.connectionStateService
        .markConnected({
          userId: user.id,
          socketId: client.id,
        })
        .catch((error) => {
          this.warnConnectionStateError('mark connected', user.id, client.id, error);
        });
    }

    this.logger.log(`connected ${user?.id ?? authedClient.id}`);
  }

  handleDisconnect(client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user;

    if (user) {
      void this.connectionStateService
        .markDisconnected({
          userId: user.id,
          socketId: client.id,
        })
        .catch((error) => {
          this.warnConnectionStateError('mark disconnected', user.id, client.id, error);
        });
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

    client.emit('pong', event);
  }

  @SubscribeMessage('command')
  async handleCommand(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    const parsed = parseCommandEnvelope(body);

    if ('reason' in parsed) {
      const rejected: CommandRejectedEvent = parsed;
      client.emit('command:rejected', rejected);
      return;
    }

    const authedClient = client as AuthenticatedSocket;
    const result = await this.gameCommandService.handleCommand(
      parsed,
      authedClient.data.user ?? null,
    );

    if (result.type === 'COMMAND_REJECTED') {
      this.emitRoomRejected(client, result);
      return;
    }

    await this.applyCommandEffects(client, authedClient.data.user ?? null, result.effects);
    this.emitAccepted(client, result.requestId, result.receivedType);
  }

  @SubscribeMessage('whoami')
  handleWhoami(@ConnectedSocket() client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const event = authedClient.data.user as WhoamiEvent | undefined;

    client.emit('whoami', event);
  }

  private async applyCommandEffects(
    client: Socket,
    user: { id: string; email: string } | null,
    effects: GameCommandEffect[],
  ) {
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
        continue;
      }

      this.emitPrivate(effect);
    }
  }

  private emitBroadcast(effect: GameCommandBroadcastEffect) {
    this.server.to(effect.roomId).emit(effect.eventName, effect.payload);
  }

  private emitPrivate(effect: GameCommandPrivateEventEffect) {
    this.server.to(`user:${effect.userId}`).emit(effect.eventName, effect.payload);
  }

  private emitAccepted(client: Socket, requestId: string, receivedType: string) {
    const accepted: CommandAcceptedEvent = {
      type: 'COMMAND_ACCEPTED',
      requestId,
      receivedType,
    };

    client.emit('command:accepted', accepted);
  }

  private emitRoomRejected(client: Socket, result: GameCommandRejectedResult) {
    const rejected: CommandRejectedEvent = {
      type: 'COMMAND_REJECTED',
      requestId: result.requestId,
      reason: result.reason,
      message: result.message,
    };

    client.emit('command:rejected', rejected);
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
