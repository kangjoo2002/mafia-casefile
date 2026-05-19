import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GameSessionModule } from './game-session.module';
import { GameSessionService } from './game-session.service';
import { RedisService } from '../redis/redis.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;
process.env.GAME_SESSION_TTL_SECONDS =
  process.env.GAME_SESSION_TTL_SECONDS ?? '86400';

@Module({
  imports: [GameSessionModule],
})
class GameSessionReconnectTestModule {}

let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
let redisService: RedisService;

before(async () => {
  app = await NestFactory.createApplicationContext(GameSessionReconnectTestModule, {
    logger: false,
  });
  redisService = app.get(RedisService);
  await redisService.ping();
});

after(async () => {
  await app.close();
});

function createSessionInput(gameId: string) {
  return {
    gameId,
    roomId: randomUUID(),
    hostUserId: 'host-user',
    players: [
      {
        userId: 'user-1',
        nickname: 'alpha',
        role: 'MAFIA' as const,
      },
      {
        userId: 'user-2',
        nickname: 'bravo',
        role: 'DOCTOR' as const,
      },
      {
        userId: 'user-3',
        nickname: 'charlie',
        role: 'POLICE' as const,
      },
      {
        userId: 'user-4',
        nickname: 'delta',
        role: 'CITIZEN' as const,
      },
    ],
    startedAt: new Date('2026-05-16T12:00:00.000Z'),
  };
}

test('markPlayerConnected()가 player connectionStatus를 CONNECTED로 바꾼다', async () => {
  const service = app.get(GameSessionService);
  const gameId = randomUUID();
  const session = await service.startGameSession(createSessionInput(gameId));

  try {
    const connectedAt = new Date('2026-05-16T12:05:00.000Z');
    const updated = await service.markPlayerConnected({
      gameId,
      userId: 'user-2',
      connectedAt,
    });

    const player = updated.players.find((entry) => entry.userId === 'user-2');

    assert.ok(player);
    assert.equal(player?.connectionStatus, 'CONNECTED');
    assert.equal(player?.status, 'ALIVE');
    assert.equal(player?.lastSeenAt.toISOString(), connectedAt.toISOString());
    assert.equal(updated.version, session.version + 1);
    assert.equal(updated.phase, session.phase);
    assert.equal(updated.turn, session.turn);
    assert.deepEqual(updated.votes, session.votes);
    assert.deepEqual(updated.nightActions, session.nightActions);
  } finally {
    await redisService.del(`game-session:${gameId}`);
  }
});

test('game session이 없으면 game session not found', async () => {
  const service = app.get(GameSessionService);

  await assert.rejects(
    async () =>
      await service.markPlayerConnected({
        gameId: randomUUID(),
        userId: 'user-1',
      }),
    /game session not found/,
  );
});

test('player가 없으면 player not found', async () => {
  const service = app.get(GameSessionService);
  const gameId = randomUUID();

  await service.startGameSession(createSessionInput(gameId));

  try {
    await assert.rejects(
      async () =>
        await service.markPlayerConnected({
          gameId,
          userId: 'missing-user',
        }),
      /player not found/,
    );
  } finally {
    await redisService.del(`game-session:${gameId}`);
  }
});
