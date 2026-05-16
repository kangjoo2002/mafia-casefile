import { BadRequestException } from '@nestjs/common';
import type { GamePhase } from '@mafia-casefile/shared';
import type { GameSession } from './game-session';

export interface PhaseTransitionResult {
  session: GameSession;
  fromPhase: GamePhase;
  toPhase: GamePhase;
  fromTurn: number;
  toTurn: number;
}

const PHASE_ORDER: GamePhase[] = [
  'WAITING',
  'NIGHT',
  'DAY_DISCUSSION',
  'VOTING',
  'RESULT',
];

export class GameStateMachine {
  advance(session: GameSession): PhaseTransitionResult {
    const nextPhase = this.getNextPhase(session.phase);

    if (!nextPhase) {
      throw new BadRequestException('game is finished');
    }

    const nextTurn =
      session.phase === 'NIGHT' ? session.turn + 1 : session.turn;

    const updatedSession: GameSession = {
      ...structuredClone(session),
      phase: nextPhase,
      turn: nextTurn,
      version: session.version + 1,
      phaseEndsAt: null,
      updatedAt: new Date(),
    };

    return {
      session: updatedSession,
      fromPhase: session.phase,
      toPhase: nextPhase,
      fromTurn: session.turn,
      toTurn: nextTurn,
    };
  }

  finish(session: GameSession): PhaseTransitionResult {
    if (session.phase === 'FINISHED') {
      throw new BadRequestException('game is finished');
    }

    const updatedSession: GameSession = {
      ...structuredClone(session),
      phase: 'FINISHED',
      version: session.version + 1,
      phaseEndsAt: null,
      updatedAt: new Date(),
    };

    return {
      session: updatedSession,
      fromPhase: session.phase,
      toPhase: 'FINISHED',
      fromTurn: session.turn,
      toTurn: session.turn,
    };
  }

  getNextPhase(phase: GamePhase): GamePhase | null {
    if (phase === 'FINISHED') {
      return null;
    }

    const index = PHASE_ORDER.indexOf(phase);

    if (index < 0) {
      return null;
    }

    if (phase === 'RESULT') {
      return 'NIGHT';
    }

    return PHASE_ORDER[index + 1] ?? null;
  }
}
