import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { EventVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameEventRecorderService } from './game-event-recorder.service';

const prisma = new PrismaService();
const service = new GameEventRecorderService(prisma);
const gameIds = new Set<string>();

before(async () => {
  await prisma.$connect();
});

after(async () => {
  const ids = [...gameIds];

  if (ids.length > 0) {
    await prisma.gameEventLog
      .deleteMany({
        where: {
          gameId: {
            in: ids,
          },
        },
      })
      .catch(() => undefined);
  }

  await prisma.$disconnect();
});

test('recordEvent creates the first seq as 1', async () => {
  const gameId = randomUUID();
  gameIds.add(gameId);

  const created = await service.recordEvent({
    gameId,
    type: 'GameStarted',
    turn: 0,
    phase: 'WAITING',
    actorUserId: 'user-1',
    payload: {
      startedByUserId: 'user-1',
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
    requestId: 'req-1',
  });

  assert.equal(created.seq, 1);
  assert.equal(created.gameId, gameId);
});

test('recordEvent increases seq per game', async () => {
  const gameId = randomUUID();
  gameIds.add(gameId);

  const first = await service.recordEvent({
    gameId,
    type: 'PlayerJoined',
    turn: 0,
    phase: 'WAITING',
    actorUserId: 'user-1',
    payload: {
      userId: 'user-1',
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });
  const second = await service.recordEvent({
    gameId,
    type: 'PlayerReadyChanged',
    turn: 0,
    phase: 'WAITING',
    actorUserId: 'user-1',
    payload: {
      userId: 'user-1',
      isReady: true,
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });
  const third = await service.recordEvent({
    gameId,
    type: 'GameFinished',
    turn: 3,
    phase: 'FINISHED',
    actorUserId: null,
    payload: {
      winnerTeam: 'CITIZEN',
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });

  assert.deepEqual(
    [first.seq, second.seq, third.seq],
    [1, 2, 3],
  );
});

test('recordEvent starts seq at 1 for another game', async () => {
  const firstGameId = randomUUID();
  const secondGameId = randomUUID();
  gameIds.add(firstGameId);
  gameIds.add(secondGameId);

  const first = await service.recordEvent({
    gameId: firstGameId,
    type: 'GameStarted',
    turn: 0,
    phase: 'WAITING',
    payload: {
      started: true,
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });
  const second = await service.recordEvent({
    gameId: secondGameId,
    type: 'GameStarted',
    turn: 0,
    phase: 'WAITING',
    payload: {
      started: true,
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 1);
});

test('recordEvent stores payload and requestId', async () => {
  const gameId = randomUUID();
  gameIds.add(gameId);

  const created = await service.recordEvent({
    gameId,
    type: 'ChatMessageSent',
    turn: 2,
    phase: 'DAY_DISCUSSION',
    actorUserId: null,
    payload: {
      channel: 'PUBLIC',
      message: 'hello',
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
    requestId: 'req-22',
  });

  assert.deepEqual(created.payload, {
    channel: 'PUBLIC',
    message: 'hello',
  });
  assert.equal(created.requestId, 'req-22');
  assert.equal(created.actorUserId, null);
});

test('getTimeline returns seq-ordered events for the same game only', async () => {
  const gameId = randomUUID();
  const otherGameId = randomUUID();
  gameIds.add(gameId);
  gameIds.add(otherGameId);

  await service.recordEvent({
    gameId,
    type: 'PlayerJoined',
    turn: 0,
    phase: 'WAITING',
    actorUserId: 'user-1',
    payload: {
      userId: 'user-1',
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });
  await service.recordEvent({
    gameId,
    type: 'PlayerReadyChanged',
    turn: 0,
    phase: 'WAITING',
    actorUserId: 'user-1',
    payload: {
      userId: 'user-1',
      isReady: true,
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });
  await service.recordEvent({
    gameId,
    type: 'GameFinished',
    turn: 5,
    phase: 'FINISHED',
    actorUserId: null,
    payload: {
      winnerTeam: 'MAFIA',
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });
  await service.recordEvent({
    gameId: otherGameId,
    type: 'GameStarted',
    turn: 0,
    phase: 'WAITING',
    payload: {
      started: true,
    },
    visibilityDuringGame: EventVisibility.PUBLIC,
    visibilityAfterGame: EventVisibility.PUBLIC,
  });

  const timeline = await service.getTimeline(gameId);

  assert.deepEqual(
    timeline.map((event) => event.seq),
    [1, 2, 3],
  );
  assert.ok(timeline.every((event) => event.gameId === gameId));
});
