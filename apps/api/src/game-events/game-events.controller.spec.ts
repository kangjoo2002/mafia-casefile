import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventVisibility } from '@prisma/client';
import { GameEventsModule } from './game-events.module';
import { PrismaService } from '../prisma/prisma.service';

process.env.DATABASE_URL ??=
  'postgresql://mafia:mafia_password@localhost:5432/mafia_casefile';

const prisma = new PrismaService();
let app: Awaited<ReturnType<typeof NestFactory.create>>;
const gameIds = new Set<string>();

@Module({
  imports: [GameEventsModule],
})
class GameEventsTestModule {}

function getBaseUrl() {
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test port');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function request(path: string) {
  const response = await fetch(new URL(path, getBaseUrl()));
  const body = await response.json();

  return {
    status: response.status,
    body,
  };
}

before(async () => {
  await prisma.$connect();
  app = await NestFactory.create(GameEventsTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');
});

after(async () => {
  if (gameIds.size > 0) {
    await prisma.gameEventLog.deleteMany({
      where: {
        gameId: {
          in: [...gameIds],
        },
      },
    });
  }

  await prisma.$disconnect();
  await app.close();
});

test('GET /games/:gameId/timeline returns seq-ordered public events only', async () => {
  const gameId = randomUUID();
  const otherGameId = randomUUID();
  gameIds.add(gameId);
  gameIds.add(otherGameId);

  await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 2,
      type: 'GameFinished',
      turn: 3,
      phase: 'FINISHED',
      actorUserId: null,
      payload: {
        winnerTeam: 'CITIZEN',
      },
      visibilityDuringGame: EventVisibility.PUBLIC,
      visibilityAfterGame: EventVisibility.PUBLIC,
      requestId: 'req-finish',
    },
  });

  await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 1,
      type: 'GameStarted',
      turn: 0,
      phase: 'WAITING',
      actorUserId: null,
      payload: {
        startedByUserId: 'user-1',
      },
      visibilityDuringGame: EventVisibility.PUBLIC,
      visibilityAfterGame: EventVisibility.PUBLIC,
      requestId: 'req-start',
    },
  });

  await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 3,
      type: 'RoleAssigned',
      turn: 0,
      phase: 'WAITING',
      actorUserId: null,
      payload: {
        userId: 'user-1',
        role: 'MAFIA',
      },
      visibilityDuringGame: EventVisibility.PRIVATE,
      visibilityAfterGame: EventVisibility.PRIVATE,
      requestId: 'req-role',
    },
  });

  await prisma.gameEventLog.create({
    data: {
      gameId,
      seq: 4,
      type: 'ChatMessageSent',
      turn: 1,
      phase: 'DAY_DISCUSSION',
      actorUserId: 'user-2',
      payload: {
        channel: 'PUBLIC',
        message: 'hello',
      },
      visibilityDuringGame: EventVisibility.SYSTEM_ONLY,
      visibilityAfterGame: EventVisibility.PUBLIC,
      requestId: 'req-chat',
    },
  });

  await prisma.gameEventLog.create({
    data: {
      gameId: otherGameId,
      seq: 1,
      type: 'GameStarted',
      turn: 0,
      phase: 'WAITING',
      actorUserId: null,
      payload: {
        startedByUserId: 'user-x',
      },
      visibilityDuringGame: EventVisibility.PUBLIC,
      visibilityAfterGame: EventVisibility.PUBLIC,
      requestId: 'req-other',
    },
  });

  const response = await request(`/games/${gameId}/timeline`);

  assert.equal(response.status, 200);
  assert.equal(response.body.gameId, gameId);
  assert.equal(response.body.events.length, 3);
  assert.deepEqual(
    response.body.events.map((event: { seq: number }) => event.seq),
    [1, 2, 4],
  );
  assert.deepEqual(
    response.body.events.map((event: { type: string }) => event.type),
    ['GameStarted', 'GameFinished', 'ChatMessageSent'],
  );
  assert.equal(typeof response.body.events[0].createdAt, 'string');
  assert.ok(response.body.events[0].createdAt.length > 0);
  assert.deepEqual(response.body.events[1].payload, {
    winnerTeam: 'CITIZEN',
  });
  assert.deepEqual(response.body.events[2].payload, {
    channel: 'PUBLIC',
    message: 'hello',
  });
  assert.ok(
    response.body.events.every(
      (event: { visibilityAfterGame: string }) => event.visibilityAfterGame === 'PUBLIC',
    ),
  );
  assert.ok(
    response.body.events.every(
      (event: { gameId: string }) => event.gameId === gameId,
    ),
  );
});

test('GET /games/:gameId/timeline returns 200 with empty events for missing game', async () => {
  const response = await request(`/games/${randomUUID()}/timeline`);

  assert.equal(response.status, 200);
  assert.ok(response.body);
  assert.deepEqual(response.body.events, []);
});

test('GET /games/:gameId/timeline rejects empty gameId', async () => {
  const response = await fetch(new URL('/games/%20/timeline', getBaseUrl()));

  assert.equal(response.status, 400);
});
