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
}
