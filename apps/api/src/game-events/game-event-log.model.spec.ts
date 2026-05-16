import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { PrismaService } from '../prisma/prisma.service';

const prisma = new PrismaService();
const createdIds: string[] = [];

before(async () => {
  await prisma.$connect();
});

after(async () => {
  if (createdIds.length > 0) {
    await prisma.gameEventLog
      .deleteMany({
        where: {
          id: {
            in: createdIds,
          },
        },
      })
      .catch(() => undefined);
  }

  await prisma.$disconnect();
});

test('creates a game event log', async () => {
  const gameId = randomUUID();
  const created = await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 1,
      type: 'GameStarted',
      turn: 0,
      phase: 'WAITING',
      actorUserId: 'actor-user-id',
      payload: {
        startedByUserId: 'actor-user-id',
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
      requestId: 'req-1',
    },
  });

  createdIds.push(created.id);

  assert.equal(created.gameId, gameId);
  assert.equal(created.seq, 1);
  assert.equal(created.type, 'GameStarted');
  assert.equal(created.phase, 'WAITING');
});

test('returns game event logs in seq order for a game', async () => {
  const gameId = randomUUID();
  const first = await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 1,
      type: 'PlayerJoined',
      turn: 0,
      phase: 'WAITING',
      actorUserId: 'user-a',
      payload: {
        userId: 'user-a',
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
    },
  });
  const second = await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 2,
      type: 'PlayerReadyChanged',
      turn: 0,
      phase: 'WAITING',
      actorUserId: 'user-a',
      payload: {
        userId: 'user-a',
        isReady: true,
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
    },
  });

  createdIds.push(first.id, second.id);

  const rows = await prisma.gameEventLog.findMany({
    where: {
      gameId,
    },
    orderBy: {
      seq: 'asc',
    },
  });

  assert.deepEqual(
    rows.map((row) => row.seq),
    [1, 2],
  );
});

test('stores and reads json payload and visibility fields', async () => {
  const gameId = randomUUID();
  const created = await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 1,
      type: 'ChatMessageSent',
      turn: 2,
      phase: 'DAY_DISCUSSION',
      actorUserId: null,
      payload: {
        channel: 'PUBLIC',
        message: 'hello',
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
    },
  });

  createdIds.push(created.id);

  const loaded = await prisma.gameEventLog.findUnique({
    where: {
      gameId_seq: {
        gameId,
        seq: 1,
      },
    },
  });

  assert.ok(loaded);
  assert.deepEqual(loaded?.payload, {
    channel: 'PUBLIC',
    message: 'hello',
  });
  assert.equal(loaded?.visibilityDuringGame, 'PUBLIC');
  assert.equal(loaded?.visibilityAfterGame, 'PUBLIC');
});

test('rejects duplicate seq within the same game', async () => {
  const gameId = randomUUID();
  const first = await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 1,
      type: 'GameStarted',
      turn: 0,
      phase: 'WAITING',
      payload: {
        note: 'first',
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
    },
  });

  createdIds.push(first.id);

  await assert.rejects(
    prisma.gameEventLog.create({
      data: {
        gameId,
        seq: 1,
        type: 'GameFinished',
        turn: 10,
        phase: 'FINISHED',
        payload: {
          winnerTeam: 'CITIZEN',
        },
        visibilityDuringGame: 'PUBLIC',
        visibilityAfterGame: 'PUBLIC',
      },
    }),
  );
});

test('allows same seq in different games', async () => {
  const firstGameId = randomUUID();
  const secondGameId = randomUUID();

  const first = await prisma.gameEventLog.create({
    data: {
      gameId: firstGameId,
      seq: 1,
      type: 'GameStarted',
      turn: 0,
      phase: 'WAITING',
      payload: {
        started: true,
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
    },
  });
  const second = await prisma.gameEventLog.create({
    data: {
      gameId: secondGameId,
      seq: 1,
      type: 'GameStarted',
      turn: 0,
      phase: 'WAITING',
      payload: {
        started: true,
      },
      visibilityDuringGame: 'PUBLIC',
      visibilityAfterGame: 'PUBLIC',
    },
  });

  createdIds.push(first.id, second.id);

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 1);
  assert.notEqual(first.gameId, second.gameId);
});
