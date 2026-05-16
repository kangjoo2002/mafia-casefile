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
import { EventVisibility } from '@prisma/client';
import { JwtService } from '../auth/jwt.service';
import { GameEventRecorderService } from '../game-events/game-event-recorder.service';
import { RoomsService, type Room } from '../rooms/rooms.service';
import type {
  CommandAcceptedEvent,
  CommandRejectedEvent,
  PongEvent,
  WhoamiEvent,
} from '@mafia-casefile/shared';
import { parseCommandEnvelope } from './command-envelope';
import { AuthenticatedSocket } from './socket-user';

type RoomJoinCommandPayload = {
  nickname?: unknown;
};

type RoomUpdatedEvent = {
  room: Room;
};

type RoomCommandEnvelope = {
  requestId: string;
  gameId: string;
  type: string;
  payload: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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
    @Inject(RoomsService) private readonly roomsService: RoomsService,
    @Inject(GameEventRecorderService)
    private readonly gameEventRecorder: GameEventRecorderService,
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
    this.logger.log(
      `connected ${authedClient.data.user?.id ?? authedClient.id}`,
    );
  }

  handleDisconnect(client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    this.logger.log(
      `disconnected ${authedClient.data.user?.id ?? authedClient.id}`,
    );
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

    if (parsed.type === 'JOIN_ROOM') {
      await this.handleJoinRoom(parsed, client);
      return;
    }

    if (parsed.type === 'LEAVE_ROOM') {
      await this.handleLeaveRoom(parsed, client);
      return;
    }

    this.emitAccepted(client, parsed.requestId, parsed.type);
  }

  @SubscribeMessage('whoami')
  handleWhoami(@ConnectedSocket() client: Socket) {
    const authedClient = client as AuthenticatedSocket;
    const event = authedClient.data.user as WhoamiEvent | undefined;

    client.emit('whoami', event);
  }

  private emitAccepted(client: Socket, requestId: string, receivedType: string) {
    const accepted: CommandAcceptedEvent = {
      type: 'COMMAND_ACCEPTED',
      requestId,
      receivedType,
    };

    client.emit('command:accepted', accepted);
  }

  private emitRoomRejected(
    client: Socket,
    requestId: string,
    reason: string,
    message: string,
  ) {
    const rejected: CommandRejectedEvent = {
      type: 'COMMAND_REJECTED',
      requestId,
      reason,
      message,
    };

    client.emit('command:rejected', rejected);
  }

  private async handleJoinRoom(
    parsed: RoomCommandEnvelope,
    client: Socket,
  ) {
    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user;

    if (!user) {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
      return;
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
      return;
    }

    const payload = parsed.payload as RoomJoinCommandPayload;
    const nickname = payload.nickname;

    if (!isNonEmptyString(nickname)) {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room nickname is required.',
      );
      return;
    }

    try {
      const room = this.roomsService.joinRoom(parsed.gameId, {
        userId: user.id,
        nickname,
      });

      await client.join(parsed.gameId);
      await this.gameEventRecorder.recordEvent({
        gameId: parsed.gameId,
        type: 'PlayerJoined',
        turn: 0,
        phase: 'WAITING',
        actorUserId: user.id,
        payload: {
          roomId: parsed.gameId,
          userId: user.id,
          nickname,
        },
        visibilityDuringGame: EventVisibility.PUBLIC,
        visibilityAfterGame: EventVisibility.PUBLIC,
        requestId: parsed.requestId,
      });

      const roomEvent: RoomUpdatedEvent = {
        room,
      };
      this.server.to(parsed.gameId).emit('room:updated', roomEvent);
      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Room join failed.';
      const reason =
        message === 'room not found'
          ? 'ROOM_NOT_FOUND'
          : message === 'room is full'
            ? 'ROOM_FULL'
            : message === 'room is not joinable'
              ? 'ROOM_NOT_JOINABLE'
              : 'ROOM_COMMAND_FAILED';

      this.emitRoomRejected(client, parsed.requestId, reason, message);
    }
  }

  private async handleLeaveRoom(
    parsed: RoomCommandEnvelope,
    client: Socket,
  ) {
    const authedClient = client as AuthenticatedSocket;
    const user = authedClient.data.user;

    if (!user) {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
      return;
    }

    try {
      const room = this.roomsService.leaveRoom(parsed.gameId, user.id);

      await client.leave(parsed.gameId);
      const roomEvent: RoomUpdatedEvent = {
        room,
      };
      this.server.to(parsed.gameId).emit('room:updated', roomEvent);
      await this.gameEventRecorder.recordEvent({
        gameId: parsed.gameId,
        type: 'PlayerLeft',
        turn: 0,
        phase: 'WAITING',
        actorUserId: user.id,
        payload: {
          roomId: parsed.gameId,
          userId: user.id,
          reason: 'LEFT_ROOM',
        },
        visibilityDuringGame: EventVisibility.PUBLIC,
        visibilityAfterGame: EventVisibility.PUBLIC,
        requestId: parsed.requestId,
      });

      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Room leave failed.';
      const reason =
        message === 'room not found'
          ? 'ROOM_NOT_FOUND'
          : message === 'participant not found'
            ? 'PARTICIPANT_NOT_FOUND'
            : 'ROOM_COMMAND_FAILED';

      this.emitRoomRejected(client, parsed.requestId, reason, message);
    }
  }
}
