import { Inject, Injectable } from '@nestjs/common';
import type {
  ConnectionStatus,
  PlayerStatus,
  Role,
} from '@mafia-casefile/shared';
import {
  GAME_SESSION_REPOSITORY,
  type GameSession,
  type GameSessionPlayer,
  type GameSessionRepository,
} from './game-session';
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

export interface VoteTallyEntry {
  targetUserId: string;
  count: number;
}

export interface VoteCastResult {
  session: GameSession;
  actor: GameSessionPlayer;
  target: GameSessionPlayer;
  tally: VoteTallyEntry[];
  duplicateRequest: boolean;
}

export type WinnerTeam = 'MAFIA' | 'CITIZEN';

export interface NightOutcomeResult {
  session: GameSession;
  killed: GameSessionPlayer | null;
  protectedTarget: GameSessionPlayer | null;
  winnerTeam: WinnerTeam | null;
}

export interface VotingOutcomeResult {
  session: GameSession;
  executed: GameSessionPlayer | null;
  tally: VoteTallyEntry[];
  winnerTeam: WinnerTeam | null;
}

@Injectable()
export class GameSessionService {
  private readonly stateMachine = new GameStateMachine();

  constructor(
    @Inject(GAME_SESSION_REPOSITORY)
    private readonly repository: GameSessionRepository,
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

  async castVote(
    gameId: string,
    actorUserId: string,
    targetUserId: string,
    requestId: string,
  ): Promise<VoteCastResult> {
    const session = await this.findByGameId(gameId);

    if (!session) {
      throw new Error('game session not found');
    }

    if (session.phase !== 'VOTING') {
      throw new Error('votes are only allowed during VOTING');
    }

    if (session.processedRequests[requestId]) {
      const actor = session.players.find(
        (player) => player.userId === actorUserId,
      );

      if (!actor) {
        throw new Error('actor not found');
      }

      const target = session.players.find(
        (player) => player.userId === targetUserId,
      );

      if (!target) {
        throw new Error('target player not found');
      }

      return {
        session,
        actor: structuredClone(actor),
        target: structuredClone(target),
        tally: this.calculateVoteTally(session),
        duplicateRequest: true,
      };
    }

    const actor = session.players.find(
      (player) => player.userId === actorUserId,
    );

    if (!actor) {
      throw new Error('actor not found');
    }

    if (actor.status !== 'ALIVE') {
      throw new Error('dead player cannot vote');
    }

    const target = session.players.find(
      (player) => player.userId === targetUserId,
    );

    if (!target) {
      throw new Error('target player not found');
    }

    if (target.status !== 'ALIVE') {
      throw new Error('target player is not alive');
    }

    if (session.votes[actorUserId]) {
      throw new Error('vote already cast');
    }

    const updatedSession: GameSession = {
      ...structuredClone(session),
      votes: {
        ...session.votes,
        [actorUserId]: targetUserId,
      },
      processedRequests: {
        ...session.processedRequests,
        [requestId]: targetUserId,
      },
      version: session.version + 1,
      updatedAt: new Date(),
    };

    const saved = await this.repository.save(updatedSession);

    return {
      session: saved,
      actor: structuredClone(actor),
      target: structuredClone(target),
      tally: this.calculateVoteTally(saved),
      duplicateRequest: false,
    };
  }

  calculateVoteTally(session: GameSession): VoteTallyEntry[] {
    const counts = new Map<string, number>();

    for (const targetUserId of Object.values(session.votes)) {
      counts.set(targetUserId, (counts.get(targetUserId) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([targetUserId, count]) => ({ targetUserId, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return left.targetUserId.localeCompare(right.targetUserId);
      });
  }

  async resolveNightOutcome(gameId: string): Promise<NightOutcomeResult> {
    const session = await this.findByGameId(gameId);

    if (!session) {
      throw new Error('game session not found');
    }

    const protectedTarget = this.findPlayer(
      session,
      session.nightActions.doctorTarget ?? null,
    );
    const targetUserId =
      session.nightActions.mafiaTarget &&
      session.nightActions.mafiaTarget !== session.nightActions.doctorTarget
        ? session.nightActions.mafiaTarget
        : null;

    if (!targetUserId) {
      const clearedSession = this.clearNightActions(session);
      const saved = await this.repository.save(clearedSession);

      return {
        session: saved,
        killed: null,
        protectedTarget,
        winnerTeam: this.evaluateWinner(saved),
      };
    }

    const target = this.findPlayer(session, targetUserId);

    if (!target) {
      throw new Error('target player not found');
    }

    if (target.status !== 'ALIVE') {
      throw new Error('target player is not alive');
    }

    const updatedSession = this.applyPlayerDeath(session, targetUserId, {
      nightActions: {},
    });
    const saved = await this.repository.save(updatedSession);

    return {
      session: saved,
      killed: structuredClone(target),
      protectedTarget,
      winnerTeam: this.evaluateWinner(saved),
    };
  }

  async resolveVotingOutcome(gameId: string): Promise<VotingOutcomeResult> {
    const session = await this.findByGameId(gameId);

    if (!session) {
      throw new Error('game session not found');
    }

    const tally = this.calculateVoteTally(session);
    const executedTargetId = this.selectVoteWinner(tally);

    if (!executedTargetId) {
      const clearedSession = this.clearVotes(session);
      const saved = await this.repository.save(clearedSession);

      return {
        session: saved,
        executed: null,
        tally,
        winnerTeam: this.evaluateWinner(saved),
      };
    }

    const target = this.findPlayer(session, executedTargetId);

    if (!target) {
      throw new Error('target player not found');
    }

    const updatedSession = this.applyPlayerDeath(session, executedTargetId, {
      votes: {},
    });
    const saved = await this.repository.save(updatedSession);

    return {
      session: saved,
      executed: structuredClone(target),
      tally,
      winnerTeam: this.evaluateWinner(saved),
    };
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

  private findPlayer(
    session: GameSession,
    userId: string | null,
  ): GameSessionPlayer | null {
    if (!userId) {
      return null;
    }

    const player = session.players.find(
      (current) => current.userId === userId,
    );

    return player ? structuredClone(player) : null;
  }

  private clearVotes(session: GameSession): GameSession {
    return {
      ...structuredClone(session),
      votes: {},
      version: session.version + 1,
      updatedAt: new Date(),
    };
  }

  private clearNightActions(session: GameSession): GameSession {
    return {
      ...structuredClone(session),
      nightActions: {},
      version: session.version + 1,
      updatedAt: new Date(),
    };
  }

  private applyPlayerDeath(
    session: GameSession,
    targetUserId: string,
    patch: Partial<Pick<GameSession, 'votes' | 'nightActions'>>,
  ): GameSession {
    return {
      ...structuredClone(session),
      players: session.players.map((player) =>
        player.userId === targetUserId
          ? {
              ...player,
              status: 'DEAD' satisfies PlayerStatus,
              lastSeenAt: new Date(),
            }
          : player,
      ),
      votes: patch.votes ?? session.votes,
      nightActions: patch.nightActions ?? session.nightActions,
      version: session.version + 1,
      updatedAt: new Date(),
    };
  }

  private selectVoteWinner(tally: VoteTallyEntry[]): string | null {
    const first = tally[0];

    if (!first) {
      return null;
    }

    const second = tally[1];
    if (second && second.count === first.count) {
      return null;
    }

    return first.targetUserId;
  }

  private evaluateWinner(session: GameSession): WinnerTeam | null {
    const mafiaAlive = session.players.filter(
      (player) => player.status === 'ALIVE' && player.role === 'MAFIA',
    ).length;
    const nonMafiaAlive = session.players.filter(
      (player) => player.status === 'ALIVE' && player.role !== 'MAFIA',
    ).length;

    if (mafiaAlive === 0) {
      return 'CITIZEN';
    }

    if (mafiaAlive >= nonMafiaAlive) {
      return 'MAFIA';
    }

    return null;
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

    if (target.status !== 'ALIVE') {
      throw new Error('target player is not alive');
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
