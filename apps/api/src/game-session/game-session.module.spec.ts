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
class GameSessionModuleTestModule {}

let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
const redisService = new RedisService();

before(async () => {
  await redisService.ping();
  app = await NestFactory.createApplicationContext(GameSessionModuleTestModule, {
    logger: false,
  });
});

after(async () => {
  await app.close();
  await redisService.onModuleDestroy();
});

test('GameSessionModule wires the Redis repository', async () => {
  const service = app.get(GameSessionService);

  const startedAt = new Date('2026-05-16T12:00:00.000Z');
  const gameId = randomUUID();
  const roomId = randomUUID();

  try {
    const session = await service.startGameSession({
      gameId,
      roomId,
      hostUserId: 'host-user',
      players: [
        {
          userId: 'user-1',
          nickname: 'alpha',
          role: 'MAFIA',
        },
        {
          userId: 'user-2',
          nickname: 'bravo',
          role: 'DOCTOR',
        },
        {
          userId: 'user-3',
          nickname: 'charlie',
          role: 'POLICE',
        },
        {
          userId: 'user-4',
          nickname: 'delta',
          role: 'CITIZEN',
        },
      ],
      startedAt,
    });

    const key = redisService.buildKey(`game-session:${gameId}`);
    const ttl = await redisService.getClient().ttl(key);
    const loaded = await service.findByGameId(gameId);

    assert.ok(ttl > 0);
    assert.ok(loaded);
    assert.equal(session.gameId, gameId);
    assert.ok(loaded.createdAt instanceof Date);
    assert.ok(loaded.updatedAt instanceof Date);
    assert.ok(loaded.players[0]?.lastSeenAt instanceof Date);
  } finally {
    await redisService.del(`game-session:${gameId}`);
  }
});
