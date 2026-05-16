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
    }

    this.logger.log(`connected ${user?.id ?? authedClient.id}`);
  }

  handleDisconnect(client: Socket) {
    const authedClient = client as AuthenticatedSocket;
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

    await this.applyCommandEffects(client, result.effects);
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
    effects: GameCommandEffect[],
  ) {
    for (const effect of effects) {
      if (effect.kind === 'join') {
        await client.join(effect.roomId);
        continue;
      }

      if (effect.kind === 'leave') {
        await client.leave(effect.roomId);
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
}
