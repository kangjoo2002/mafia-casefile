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
import { GameSessionService } from '../game-session/game-session.service';
import { RoomsService, type Room } from '../rooms/rooms.service';
import type {
  GameStartedEvent,
  CommandAcceptedEvent,
  CommandRejectedEvent,
  PongEvent,
  PhaseChangedEvent,
  Role,
  RoleAssignedEvent,
  WhoamiEvent,
} from '@mafia-casefile/shared';
import { parseCommandEnvelope } from './command-envelope';
import { AuthenticatedSocket } from './socket-user';

type RoomJoinCommandPayload = {
  nickname?: unknown;
};

type RoomReadyCommandPayload = {
  isReady?: unknown;
};

type RoomStartCommandPayload = Record<string, never>;

type VoteCommandPayload = {
  targetUserId?: unknown;
};

type NightTargetCommandPayload = {
  targetUserId?: unknown;
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

function shuffle<T>(items: T[]) {
  const values = [...items];

  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }

  return values;
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
    @Inject(GameSessionService)
    private readonly gameSessionService: GameSessionService,
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
    const user = authedClient.data.user;

    if (user) {
      void client.join(`user:${user.id}`);
    }

    this.logger.log(
      `connected ${user?.id ?? authedClient.id}`,
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

    if (parsed.type === 'CHANGE_READY') {
      await this.handleChangeReady(parsed, client);
      return;
    }

    if (parsed.type === 'START_GAME') {
      await this.handleStartGame(parsed, client);
      return;
    }

    if (parsed.type === 'NEXT_PHASE') {
      await this.handleNextPhase(parsed, client);
      return;
    }

    if (parsed.type === 'CAST_VOTE') {
      await this.handleCastVote(parsed, client);
      return;
    }

    if (parsed.type === 'SELECT_MAFIA_TARGET') {
      await this.handleSelectMafiaTarget(parsed, client);
      return;
    }

    if (parsed.type === 'SELECT_DOCTOR_TARGET') {
      await this.handleSelectDoctorTarget(parsed, client);
      return;
    }

    if (parsed.type === 'SELECT_POLICE_TARGET') {
      await this.handleSelectPoliceTarget(parsed, client);
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

  private async handleChangeReady(
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

    const payload = parsed.payload as RoomReadyCommandPayload;

    if (typeof payload.isReady !== 'boolean') {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room ready state is required.',
      );
      return;
    }

    try {
      const room = this.roomsService.changeReady(
        parsed.gameId,
        user.id,
        payload.isReady,
      );

      await this.gameEventRecorder.recordEvent({
        gameId: parsed.gameId,
        type: 'PlayerReadyChanged',
        turn: 0,
        phase: 'WAITING',
        actorUserId: user.id,
        payload: {
          userId: user.id,
          isReady: payload.isReady,
        },
        visibilityDuringGame: EventVisibility.PUBLIC,
        visibilityAfterGame: EventVisibility.PUBLIC,
        requestId: parsed.requestId,
      });

      this.server.to(parsed.gameId).emit('room:updated', {
        room,
      });
      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Room ready change failed.';
      const reason =
        message === 'room not found'
          ? 'ROOM_NOT_FOUND'
          : message === 'room is not joinable'
            ? 'ROOM_NOT_JOINABLE'
            : message === 'participant not found'
              ? 'PARTICIPANT_NOT_FOUND'
              : 'ROOM_COMMAND_FAILED';

      this.emitRoomRejected(client, parsed.requestId, reason, message);
    }
  }

  private async handleStartGame(
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

    const payload = parsed.payload as RoomStartCommandPayload;
    void payload;

    try {
      const room = this.roomsService.startGame(parsed.gameId, user.id);
      const startedAt = new Date().toISOString();
      const roleAssignments = this.buildRoleAssignments(room);

      await this.gameSessionService.startGameSession({
        gameId: parsed.gameId,
        roomId: parsed.gameId,
        hostUserId: user.id,
        players: roleAssignments.map((assignment, index) => {
          const participant = room.participants.find(
            (current) => current.userId === assignment.userId,
          );

          return {
            userId: assignment.userId,
            nickname: participant?.nickname ?? `player-${index + 1}`,
            role: assignment.role,
          };
        }),
      });

      await this.gameEventRecorder.recordEvent({
        gameId: parsed.gameId,
        type: 'GameStarted',
        turn: 0,
        phase: 'WAITING',
        actorUserId: null,
        payload: {
          gameId: parsed.gameId,
          roomId: parsed.gameId,
          startedByUserId: user.id,
          startedAt,
        },
        visibilityDuringGame: EventVisibility.PUBLIC,
        visibilityAfterGame: EventVisibility.PUBLIC,
        requestId: parsed.requestId,
      });

      const gameStartedEvent: GameStartedEvent = {
        type: 'game:started',
        gameId: parsed.gameId,
        startedByUserId: user.id,
        startedAt,
      };

      this.server.to(parsed.gameId).emit('game:started', gameStartedEvent);

      for (const assignment of roleAssignments) {
        await this.gameEventRecorder.recordEvent({
          gameId: parsed.gameId,
          type: 'RoleAssigned',
          turn: 0,
          phase: 'WAITING',
          actorUserId: null,
          payload: {
            gameId: parsed.gameId,
            userId: assignment.userId,
            role: assignment.role,
          },
          visibilityDuringGame: EventVisibility.PRIVATE,
          visibilityAfterGame: EventVisibility.PUBLIC,
          requestId: parsed.requestId,
        });

        const roleAssignedEvent: RoleAssignedEvent = {
          type: 'role:assigned',
          gameId: parsed.gameId,
          userId: assignment.userId,
          role: assignment.role,
        };

        this.server
          .to(`user:${assignment.userId}`)
          .emit('role:assigned', roleAssignedEvent);
      }

      this.server.to(parsed.gameId).emit('room:updated', {
        room,
      });
      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Room start failed.';
      const reason =
        message === 'room not found'
          ? 'ROOM_NOT_FOUND'
          : message === 'only host can start game'
            ? 'NOT_ROOM_HOST'
            : message === 'room needs at least 4 players'
              ? 'ROOM_TOO_SMALL'
              : message === 'not all participants are ready'
                ? 'ROOM_NOT_READY'
                : message === 'room is not startable'
                  ? 'ROOM_NOT_STARTABLE'
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

  private async handleNextPhase(
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

    try {
      const transition = await this.gameSessionService.advancePhase(
        parsed.gameId,
      );

      let resolutionEvent: {
        type: string;
        payload: Record<string, unknown>;
        visibilityDuringGame: EventVisibility;
      } | null = null;
      let gameFinishedPayload:
        | {
            winnerTeam: 'MAFIA' | 'CITIZEN';
            reason: string;
          }
        | null = null;

      if (
        transition.fromPhase === 'NIGHT' &&
        transition.toPhase === 'DAY_DISCUSSION'
      ) {
        const outcome = await this.gameSessionService.resolveNightOutcome(
          parsed.gameId,
        );

        if (outcome.killed) {
          resolutionEvent = {
            type: 'PlayerKilled',
            payload: {
              targetUserId: outcome.killed.userId,
              cause: 'MAFIA_ATTACK',
              protectedByDoctor:
                outcome.protectedTarget?.userId === outcome.killed.userId,
            },
            visibilityDuringGame: EventVisibility.PUBLIC,
          };
        }

        if (outcome.winnerTeam) {
          await this.gameSessionService.finishGame(parsed.gameId);
          gameFinishedPayload = {
            winnerTeam: outcome.winnerTeam,
            reason:
              outcome.winnerTeam === 'CITIZEN'
                ? 'MAFIA_ELIMINATED'
                : 'MAFIA_PARITY_REACHED',
          };
        }
      }

      if (
        transition.fromPhase === 'VOTING' &&
        transition.toPhase === 'RESULT'
      ) {
        const outcome = await this.gameSessionService.resolveVotingOutcome(
          parsed.gameId,
        );

        if (outcome.executed) {
          resolutionEvent = {
            type: 'PlayerExecuted',
            payload: {
              targetUserId: outcome.executed.userId,
              voteResult: outcome.tally,
            },
            visibilityDuringGame: EventVisibility.PUBLIC,
          };
        }

        if (outcome.winnerTeam) {
          await this.gameSessionService.finishGame(parsed.gameId);
          gameFinishedPayload = {
            winnerTeam: outcome.winnerTeam,
            reason:
              outcome.winnerTeam === 'CITIZEN'
                ? 'MAFIA_ELIMINATED'
                : 'MAFIA_PARITY_REACHED',
          };
        }
      }

      if (resolutionEvent) {
        await this.gameEventRecorder.recordEvent({
          gameId: parsed.gameId,
          type: resolutionEvent.type,
          turn: transition.toTurn,
          phase: transition.toPhase,
          actorUserId: null,
          payload: resolutionEvent.payload,
          visibilityDuringGame: resolutionEvent.visibilityDuringGame,
          visibilityAfterGame: EventVisibility.PUBLIC,
          requestId: parsed.requestId,
        });
      }

      if (gameFinishedPayload) {
        const finishedSession = await this.gameSessionService.findByGameId(
          parsed.gameId,
        );

        await this.gameEventRecorder.recordEvent({
          gameId: parsed.gameId,
          type: 'GameFinished',
          turn: finishedSession?.turn ?? transition.toTurn,
          phase: finishedSession?.phase ?? transition.toPhase,
          actorUserId: null,
          payload: gameFinishedPayload,
          visibilityDuringGame: EventVisibility.PUBLIC,
          visibilityAfterGame: EventVisibility.PUBLIC,
          requestId: parsed.requestId,
        });
      }

      await this.gameEventRecorder.recordEvent({
        gameId: parsed.gameId,
        type: 'PhaseChanged',
        turn: transition.toTurn,
        phase: transition.toPhase,
        actorUserId: null,
        payload: {
          gameId: parsed.gameId,
          fromPhase: transition.fromPhase,
          toPhase: transition.toPhase,
          turn: transition.toTurn,
          requestedByUserId: user.id,
        },
        visibilityDuringGame: EventVisibility.PUBLIC,
        visibilityAfterGame: EventVisibility.PUBLIC,
        requestId: parsed.requestId,
      });

      const phaseChangedEvent: PhaseChangedEvent = {
        type: 'phase:changed',
        gameId: parsed.gameId,
        fromPhase: transition.fromPhase,
        toPhase: transition.toPhase,
        turn: transition.toTurn,
        requestedByUserId: user.id,
        changedAt: new Date().toISOString(),
      };

      this.server.to(parsed.gameId).emit('phase:changed', phaseChangedEvent);
      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Phase transition failed.';
      const reason =
        message === 'game session not found'
          ? 'GAME_SESSION_NOT_FOUND'
          : message === 'game is finished'
            ? 'GAME_ALREADY_FINISHED'
            : 'ROOM_COMMAND_FAILED';

      this.emitRoomRejected(client, parsed.requestId, reason, message);
    }
  }

  private async handleCastVote(
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

    const payload = parsed.payload as VoteCommandPayload;

    if (!isNonEmptyString(payload.targetUserId)) {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Vote target user is required.',
      );
      return;
    }

    try {
      const result = await this.gameSessionService.castVote(
        parsed.gameId,
        user.id,
        payload.targetUserId,
        parsed.requestId,
      );

      if (!result.duplicateRequest) {
        await this.gameEventRecorder.recordEvent({
          gameId: parsed.gameId,
          type: 'VoteCasted',
          turn: result.session.turn,
          phase: result.session.phase,
          actorUserId: user.id,
          payload: {
            targetUserId: result.target.userId,
          },
          visibilityDuringGame: EventVisibility.PUBLIC,
          visibilityAfterGame: EventVisibility.PUBLIC,
          requestId: parsed.requestId,
        });
      }

      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Vote command failed.';
      const reason =
        message === 'game session not found'
          ? 'GAME_SESSION_NOT_FOUND'
          : message === 'votes are only allowed during VOTING'
            ? 'GAME_NOT_IN_VOTING'
            : message === 'actor not found'
              ? 'PLAYER_NOT_IN_GAME'
              : message === 'dead player cannot vote'
                ? 'PLAYER_NOT_ALIVE'
                : message === 'target player not found'
                  ? 'TARGET_PLAYER_NOT_FOUND'
                  : message === 'target player is not alive'
                    ? 'TARGET_PLAYER_NOT_ALIVE'
                    : message === 'vote already cast'
                      ? 'VOTE_ALREADY_CAST'
                      : 'ROOM_COMMAND_FAILED';

      this.emitRoomRejected(client, parsed.requestId, reason, message);
    }
  }

  private async handleSelectMafiaTarget(
    parsed: RoomCommandEnvelope,
    client: Socket,
  ) {
    await this.handleNightTargetCommand(parsed, client, 'mafia');
  }

  private async handleSelectDoctorTarget(
    parsed: RoomCommandEnvelope,
    client: Socket,
  ) {
    await this.handleNightTargetCommand(parsed, client, 'doctor');
  }

  private async handleSelectPoliceTarget(
    parsed: RoomCommandEnvelope,
    client: Socket,
  ) {
    await this.handleNightTargetCommand(parsed, client, 'police');
  }

  private async handleNightTargetCommand(
    parsed: RoomCommandEnvelope,
    client: Socket,
    action: 'mafia' | 'doctor' | 'police',
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

    const payload = parsed.payload as NightTargetCommandPayload;

    if (!isNonEmptyString(payload.targetUserId)) {
      this.emitRoomRejected(
        client,
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Night target user is required.',
      );
      return;
    }

    try {
      const selection =
        action === 'mafia'
          ? await this.gameSessionService.selectMafiaTarget(
              parsed.gameId,
              user.id,
              payload.targetUserId,
            )
          : action === 'doctor'
            ? await this.gameSessionService.selectDoctorTarget(
                parsed.gameId,
                user.id,
                payload.targetUserId,
              )
            : await this.gameSessionService.selectPoliceTarget(
                parsed.gameId,
                user.id,
                payload.targetUserId,
              );

      const eventType =
        action === 'mafia'
          ? 'MafiaTargetSelected'
          : action === 'doctor'
            ? 'DoctorTargetSelected'
            : 'PoliceInvestigated';
      const visibilityDuringGame =
        action === 'mafia'
          ? EventVisibility.MAFIA_ONLY
          : EventVisibility.PRIVATE;
      const eventPayload =
        action === 'police'
          ? {
              targetUserId: selection.target.userId,
              result: selection.target.role,
            }
          : {
              targetUserId: selection.target.userId,
            };

      await this.gameEventRecorder.recordEvent({
        gameId: parsed.gameId,
        type: eventType,
        turn: selection.session.turn,
        phase: selection.session.phase,
        actorUserId: user.id,
        payload: eventPayload,
        visibilityDuringGame,
        visibilityAfterGame: EventVisibility.PUBLIC,
        requestId: parsed.requestId,
      });

      this.emitAccepted(client, parsed.requestId, parsed.type);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Night action failed.';
      const reason =
        message === 'game session not found'
          ? 'GAME_SESSION_NOT_FOUND'
          : message === 'night actions are only allowed during NIGHT'
            ? 'GAME_NOT_IN_NIGHT'
            : message === 'actor not found'
              ? 'PLAYER_NOT_IN_GAME'
              : message === 'dead player cannot act'
                ? 'PLAYER_NOT_ALIVE'
                : message === 'role not allowed'
                  ? 'ROLE_NOT_ALLOWED'
                  : message === 'target player not found'
                    ? 'TARGET_PLAYER_NOT_FOUND'
                    : 'ROOM_COMMAND_FAILED';

      this.emitRoomRejected(client, parsed.requestId, reason, message);
    }
  }

  private buildRoleAssignments(room: Room) {
    const participants = shuffle(room.participants);
    const rolePool: Role[] = [
      'MAFIA',
      'DOCTOR',
      'POLICE',
      ...Array.from({ length: Math.max(0, participants.length - 3) }, () => 'CITIZEN' as const),
    ];
    const roles = shuffle(rolePool);

    return participants.map((participant, index) => ({
      userId: participant.userId,
      role: roles[index]!,
    }));
  }
}
