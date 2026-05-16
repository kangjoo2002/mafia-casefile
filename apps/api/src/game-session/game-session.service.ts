import { Inject, Injectable } from '@nestjs/common';
import type {
  ConnectionStatus,
  GamePhase,
  PlayerStatus,
  Role,
} from '@mafia-casefile/shared';
import type { GameSession, GameSessionPlayer } from './game-session';
import { InMemoryGameSessionRepository } from './in-memory-game-session.repository';
import {
  GameStateMachine,
  type PhaseTransitionResult,
} from './game-state-machine';

export interface StartGameSessionPlayerInput {
  userId: string;
  nickname: string;
  role: Role;
}

export interface StartGameSessionInput {
  gameId: string;
  roomId: string;
  hostUserId: string;
  players: StartGameSessionPlayerInput[];
  startedAt?: Date;
}

export interface NightActionSelectionResult {
  session: GameSession;
  actor: GameSessionPlayer;
  target: GameSessionPlayer;
}

@Injectable()
export class GameSessionService {
  private readonly stateMachine = new GameStateMachine();

  constructor(
    @Inject(InMemoryGameSessionRepository)
    private readonly repository: InMemoryGameSessionRepository,
  ) {}

  async startGameSession(
    input: StartGameSessionInput,
  ): Promise<GameSession> {
    const startedAt = input.startedAt ?? new Date();
    const session: GameSession = {
      gameId: input.gameId,
      roomId: input.roomId,
      phase: 'NIGHT',
      turn: 0,
      version: 1,
      hostUserId: input.hostUserId,
      players: input.players.map((player) =>
        this.createGameSessionPlayer(player, startedAt),
      ),
      votes: {},
      nightActions: {},
      phaseEndsAt: null,
      processedRequests: {},
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    return await this.repository.save(session);
  }

  async advancePhase(gameId: string): Promise<PhaseTransitionResult> {
    const session = await this.findByGameId(gameId);

    if (!session) {
      throw new Error('game session not found');
    }

    const transition = this.stateMachine.advance(session);
    const saved = await this.repository.save(transition.session);

    return {
      ...transition,
      session: saved,
    };
  }

  async finishGame(gameId: string): Promise<PhaseTransitionResult> {
    const session = await this.findByGameId(gameId);

    if (!session) {
      throw new Error('game session not found');
    }

    const transition = this.stateMachine.finish(session);
    const saved = await this.repository.save(transition.session);

    return {
      ...transition,
      session: saved,
    };
  }

  async findByGameId(gameId: string): Promise<GameSession | null> {
    return await this.repository.findByGameId(gameId);
  }

  async selectMafiaTarget(
    gameId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<NightActionSelectionResult> {
    return await this.selectNightAction(
      gameId,
      actorUserId,
      targetUserId,
      'MAFIA',
      'mafiaTarget',
    );
  }

  async selectDoctorTarget(
    gameId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<NightActionSelectionResult> {
    return await this.selectNightAction(
      gameId,
      actorUserId,
      targetUserId,
      'DOCTOR',
      'doctorTarget',
    );
  }

  async selectPoliceTarget(
    gameId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<NightActionSelectionResult> {
    return await this.selectNightAction(
      gameId,
      actorUserId,
      targetUserId,
      'POLICE',
      'policeTarget',
    );
  }

  private createGameSessionPlayer(
    player: StartGameSessionPlayerInput,
    startedAt: Date,
  ): GameSessionPlayer {
    return {
      userId: player.userId,
      nickname: player.nickname,
      role: player.role,
      status: 'ALIVE' satisfies PlayerStatus,
      connectionStatus: 'CONNECTED' satisfies ConnectionStatus,
      lastSeenAt: startedAt,
    };
  }

  private async selectNightAction(
    gameId: string,
    actorUserId: string,
    targetUserId: string,
    allowedRole: Role,
    targetKey: 'mafiaTarget' | 'doctorTarget' | 'policeTarget',
  ): Promise<NightActionSelectionResult> {
    const session = await this.findByGameId(gameId);

    if (!session) {
      throw new Error('game session not found');
    }

    if (session.phase !== 'NIGHT') {
      throw new Error('night actions are only allowed during NIGHT');
    }

    const actor = session.players.find(
      (player) => player.userId === actorUserId,
    );

    if (!actor) {
      throw new Error('actor not found');
    }

    if (actor.status !== 'ALIVE') {
      throw new Error('dead player cannot act');
    }

    if (actor.role !== allowedRole) {
      throw new Error('role not allowed');
    }

    const target = session.players.find(
      (player) => player.userId === targetUserId,
    );

    if (!target) {
      throw new Error('target player not found');
    }

    const updatedSession: GameSession = {
      ...structuredClone(session),
      nightActions: {
        ...session.nightActions,
        [targetKey]: target.userId,
      },
      version: session.version + 1,
      updatedAt: new Date(),
    };

    const saved = await this.repository.save(updatedSession);

    return {
      session: saved,
      actor: structuredClone(actor),
      target: structuredClone(target),
    };
  }
}
