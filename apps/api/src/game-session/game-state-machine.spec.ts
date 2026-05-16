import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { GameSession } from './game-session';
import { GameStateMachine } from './game-state-machine';

function createSession(overrides: Partial<GameSession> = {}): GameSession {
  const now = new Date('2026-05-16T12:00:00.000Z');
  return {
    gameId: randomUUID(),
    roomId: randomUUID(),
    phase: 'NIGHT',
    turn: 0,
    version: 1,
    hostUserId: 'host-user',
    players: [],
    votes: {},
    nightActions: {},
    phaseEndsAt: null,
    processedRequests: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('GameStateMachine advances phase order', () => {
  const machine = new GameStateMachine();

  const waiting = createSession({ phase: 'WAITING', turn: 0 });
  const firstNight = machine.advance(waiting);
  const night = createSession({ phase: 'NIGHT', turn: 0 });
  const day = machine.advance(night);
  const vote = machine.advance(day.session);
  const result = machine.advance(vote.session);
  const nextNight = machine.advance(result.session);

  assert.equal(firstNight.fromPhase, 'WAITING');
  assert.equal(firstNight.toPhase, 'NIGHT');
  assert.equal(firstNight.toTurn, 0);
  assert.equal(day.fromPhase, 'NIGHT');
  assert.equal(day.toPhase, 'DAY_DISCUSSION');
  assert.equal(day.toTurn, 1);
  assert.equal(vote.toPhase, 'VOTING');
  assert.equal(result.toPhase, 'RESULT');
  assert.equal(nextNight.toPhase, 'NIGHT');
  assert.equal(nextNight.toTurn, 1);
});

test('GameStateMachine finishes game', () => {
  const machine = new GameStateMachine();
  const session = createSession({ phase: 'RESULT', turn: 2 });

  const finished = machine.finish(session);

  assert.equal(finished.toPhase, 'FINISHED');
  assert.equal(finished.toTurn, 2);
});
