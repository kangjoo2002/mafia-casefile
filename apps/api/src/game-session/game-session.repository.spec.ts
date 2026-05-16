import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { InMemoryGameSessionRepository } from './in-memory-game-session.repository';
import type { GameSession } from './game-session';

function createSession(overrides: Partial<GameSession> = {}): GameSession {
  const now = new Date('2026-05-16T12:00:00.000Z');
  return {
    gameId: randomUUID(),
    roomId: randomUUID(),
    phase: 'WAITING',
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

test('GameSession can be saved and loaded', async () => {
  const repository = new InMemoryGameSessionRepository();
  const session = createSession({
    players: [
      {
        userId: 'user-1',
        nickname: 'alpha',
        role: 'CITIZEN',
        status: 'ALIVE',
        connectionStatus: 'CONNECTED',
        lastSeenAt: new Date('2026-05-16T12:00:00.000Z'),
      },
    ],
    votes: {
      'user-1': 'user-2',
    },
    nightActions: {
      mafiaTarget: 'user-3',
      doctorTarget: 'user-4',
      policeTarget: 'user-5',
    },
    phaseEndsAt: new Date('2026-05-16T12:10:00.000Z'),
  });

  const saved = await repository.save(session);
  const loaded = await repository.findByGameId(session.gameId);

  assert.deepEqual(saved, session);
  assert.deepEqual(loaded, session);
});

test('GameSession save replaces the existing state', async () => {
  const repository = new InMemoryGameSessionRepository();
  const session = createSession({
    version: 1,
    turn: 1,
  });

  await repository.save(session);

  const updated = {
    ...session,
    phase: 'DAY_DISCUSSION' as const,
    turn: 2,
    version: 2,
    updatedAt: new Date('2026-05-16T12:05:00.000Z'),
  };

  await repository.save(updated);

  const loaded = await repository.findByGameId(session.gameId);

  assert.deepEqual(loaded, updated);
});

test('GameSession lookup returns null for missing game', async () => {
  const repository = new InMemoryGameSessionRepository();

  const loaded = await repository.findByGameId(randomUUID());

  assert.equal(loaded, null);
});
