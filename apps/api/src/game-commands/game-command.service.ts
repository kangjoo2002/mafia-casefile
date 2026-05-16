import { Inject, Injectable } from '@nestjs/common';
import { EventVisibility } from '@prisma/client';
import type { Role } from '@mafia-casefile/shared';
import { GameEventRecorderService } from '../game-events/game-event-recorder.service';
import {
  GameSessionService,
  type VoteTallyEntry,
} from '../game-session/game-session.service';
import { RoomsService, type Room } from '../rooms/rooms.service';
import type {
  GameCommandAcceptedResult,
  GameCommandBroadcastEffect,
  GameCommandEnvelope,
  GameCommandPrivateEventEffect,
  GameCommandRejectedResult,
  GameCommandResult,
  GameCommandUser,
} from './game-command.types';

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

@Injectable()
export class GameCommandService {
  constructor(
    @Inject(RoomsService) private readonly roomsService: RoomsService,
    @Inject(GameSessionService)
    private readonly gameSessionService: GameSessionService,
    @Inject(GameEventRecorderService)
    private readonly gameEventRecorder: GameEventRecorderService,
  ) {}

  async handleCommand(
    command: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    switch (command.type) {
      case 'JOIN_ROOM':
        return await this.handleJoinRoom(command, user);
      case 'LEAVE_ROOM':
        return await this.handleLeaveRoom(command, user);
      case 'CHANGE_READY':
        return await this.handleChangeReady(command, user);
      case 'START_GAME':
        return await this.handleStartGame(command, user);
      case 'NEXT_PHASE':
        return await this.handleNextPhase(command, user);
      case 'CAST_VOTE':
        return await this.handleCastVote(command, user);
      case 'SELECT_MAFIA_TARGET':
        return await this.handleNightTargetCommand(command, user, 'mafia');
      case 'SELECT_DOCTOR_TARGET':
        return await this.handleNightTargetCommand(command, user, 'doctor');
      case 'SELECT_POLICE_TARGET':
        return await this.handleNightTargetCommand(command, user, 'police');
      default:
        return this.accept(command.requestId, command.type, []);
    }
  }

  private accept(
    requestId: string,
    receivedType: string,
    effects: GameCommandAcceptedResult['effects'],
  ): GameCommandAcceptedResult {
    return {
      type: 'COMMAND_ACCEPTED',
      requestId,
      receivedType,
      effects,
    };
  }

  private reject(
    requestId: string,
    reason: string,
    message: string,
  ): GameCommandRejectedResult {
    return {
      type: 'COMMAND_REJECTED',
      requestId,
      reason,
      message,
    };
  }

  private async handleJoinRoom(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
    }

    const payload = parsed.payload as RoomJoinCommandPayload;
    const nickname = payload.nickname;

    if (!isNonEmptyString(nickname)) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room nickname is required.',
      );
    }

    try {
      const room = this.roomsService.joinRoom(parsed.gameId, {
        userId: user.id,
        nickname,
      });

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

      return this.accept(parsed.requestId, parsed.type, [
        { kind: 'join', roomId: parsed.gameId },
        {
          kind: 'broadcast',
          roomId: parsed.gameId,
          eventName: 'room:updated',
          payload: { room },
        },
      ]);
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

      return this.reject(parsed.requestId, reason, message);
    }
  }

  private async handleLeaveRoom(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    try {
      const room = this.roomsService.leaveRoom(parsed.gameId, user.id);

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

      return this.accept(parsed.requestId, parsed.type, [
        { kind: 'leave', roomId: parsed.gameId },
        {
          kind: 'broadcast',
          roomId: parsed.gameId,
          eventName: 'room:updated',
          payload: { room },
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Room leave failed.';
      const reason =
        message === 'room not found'
          ? 'ROOM_NOT_FOUND'
          : message === 'participant not found'
            ? 'PARTICIPANT_NOT_FOUND'
            : 'ROOM_COMMAND_FAILED';

      return this.reject(parsed.requestId, reason, message);
    }
  }

  private async handleChangeReady(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
    }

    const payload = parsed.payload as RoomReadyCommandPayload;

    if (typeof payload.isReady !== 'boolean') {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room ready state is required.',
      );
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

      return this.accept(parsed.requestId, parsed.type, [
        {
          kind: 'broadcast',
          roomId: parsed.gameId,
          eventName: 'room:updated',
          payload: { room },
        },
      ]);
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

      return this.reject(parsed.requestId, reason, message);
    }
  }

  private async handleStartGame(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
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

      const effects: GameCommandAcceptedResult['effects'] = [
        {
          kind: 'broadcast',
          roomId: parsed.gameId,
          eventName: 'game:started',
          payload: {
            type: 'game:started',
            gameId: parsed.gameId,
            startedByUserId: user.id,
            startedAt,
          },
        },
      ];

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

        effects.push({
          kind: 'private',
          userId: assignment.userId,
          eventName: 'role:assigned',
          payload: {
            type: 'role:assigned',
            gameId: parsed.gameId,
            userId: assignment.userId,
            role: assignment.role,
          },
        });
      }

      effects.push({
        kind: 'broadcast',
        roomId: parsed.gameId,
        eventName: 'room:updated',
        payload: { room },
      });

      return this.accept(parsed.requestId, parsed.type, effects);
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

      return this.reject(parsed.requestId, reason, message);
    }
  }

  private async handleNextPhase(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
    }

    try {
      this.roomsService.assertCanAdvancePhase(parsed.gameId, user.id);

      const transition = await this.gameSessionService.advancePhase(
        parsed.gameId,
      );

      let resolutionEvent:
        | {
            type: 'PlayerKilled' | 'PlayerExecuted';
            payload: Record<string, unknown>;
            visibilityDuringGame: EventVisibility;
          }
        | undefined;
      let gameFinishedPayload:
        | {
            winnerTeam: 'MAFIA' | 'CITIZEN';
            reason: string;
          }
        | undefined;

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

      return this.accept(parsed.requestId, parsed.type, [
        {
          kind: 'broadcast',
          roomId: parsed.gameId,
          eventName: 'phase:changed',
          payload: {
            type: 'phase:changed',
            gameId: parsed.gameId,
            fromPhase: transition.fromPhase,
            toPhase: transition.toPhase,
            turn: transition.toTurn,
            requestedByUserId: user.id,
            changedAt: new Date().toISOString(),
          },
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Phase transition failed.';
      let reason = 'ROOM_COMMAND_FAILED';

      if (message === 'game session not found') {
        reason = 'GAME_SESSION_NOT_FOUND';
      } else if (message === 'room not found') {
        reason = 'ROOM_NOT_FOUND';
      } else if (message === 'not room host') {
        reason = 'NOT_ROOM_HOST';
      } else if (message === 'room is not in progress') {
        reason = 'GAME_NOT_IN_PROGRESS';
      } else if (message === 'game is finished') {
        reason = 'GAME_ALREADY_FINISHED';
      }

      return this.reject(parsed.requestId, reason, message);
    }
  }

  private async handleCastVote(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
    }

    const payload = parsed.payload as VoteCommandPayload;

    if (!isNonEmptyString(payload.targetUserId)) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Vote target user is required.',
      );
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

      return this.accept(parsed.requestId, parsed.type, []);
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

      return this.reject(parsed.requestId, reason, message);
    }
  }

  private async handleNightTargetCommand(
    parsed: GameCommandEnvelope,
    user: GameCommandUser | null | undefined,
    action: 'mafia' | 'doctor' | 'police',
  ): Promise<GameCommandResult> {
    if (!user) {
      return this.reject(
        parsed.requestId,
        'UNAUTHORIZED',
        'Socket user is missing.',
      );
    }

    if (
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      Array.isArray(parsed.payload)
    ) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Room command payload is invalid.',
      );
    }

    const payload = parsed.payload as NightTargetCommandPayload;

    if (!isNonEmptyString(payload.targetUserId)) {
      return this.reject(
        parsed.requestId,
        'INVALID_ROOM_COMMAND',
        'Night target user is required.',
      );
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

      return this.accept(parsed.requestId, parsed.type, []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Night action failed.';
      let reason = 'ROOM_COMMAND_FAILED';

      if (message === 'game session not found') {
        reason = 'GAME_SESSION_NOT_FOUND';
      } else if (message === 'night actions are only allowed during NIGHT') {
        reason = 'GAME_NOT_IN_NIGHT';
      } else if (message === 'actor not found') {
        reason = 'PLAYER_NOT_IN_GAME';
      } else if (message === 'dead player cannot act') {
        reason = 'PLAYER_NOT_ALIVE';
      } else if (message === 'role not allowed') {
        reason = 'ROLE_NOT_ALLOWED';
      } else if (message === 'target player not found') {
        reason = 'TARGET_PLAYER_NOT_FOUND';
      } else if (message === 'target player is not alive') {
        reason = 'TARGET_PLAYER_NOT_ALIVE';
      }

      return this.reject(parsed.requestId, reason, message);
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
