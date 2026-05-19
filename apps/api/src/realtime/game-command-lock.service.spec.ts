import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import { GameCommandLockService } from './game-command-lock.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const service = new GameCommandLockService(redisService);

function lockKey(gameId: string) {
  return redisService.buildKey(`lock:game:${gameId}`);
}

async function cleanup(gameId: string) {
  await redisService.del(`lock:game:${gameId}`);
}

before(async () => {
  await redisService.ping();
});

after(async () => {
  await redisService.onModuleDestroy();
});

test('acquire()가 lock을 획득한다', async () => {
  const gameId = randomUUID();

  try {
    const lock = await service.acquire({ gameId });

    assert.ok(lock);
    assert.equal(lock.gameId, gameId);
    assert.equal(typeof lock.token, 'string');
    assert.ok(lock.token.length > 0);

    const stored = await redisService.getClient().get(lockKey(gameId));
    assert.equal(stored, lock.token);
  } finally {
    await cleanup(gameId);
  }
});

test('같은 gameId를 중복 acquire하면 두 번째는 wait 후 null을 반환한다', async () => {
  const originalWait = process.env.GAME_COMMAND_LOCK_WAIT_MS;
  const originalRetry = process.env.GAME_COMMAND_LOCK_RETRY_MS;
  const gameId = randomUUID();

  try {
    process.env.GAME_COMMAND_LOCK_WAIT_MS = '100';
    process.env.GAME_COMMAND_LOCK_RETRY_MS = '10';

    await redisService.getClient().set(lockKey(gameId), randomUUID(), 'PX', 5000);

    const startedAt = Date.now();
    const lock = await service.acquire({ gameId });
    const elapsed = Date.now() - startedAt;

    assert.equal(lock, null);
    assert.ok(elapsed >= 100);
  } finally {
    if (originalWait === undefined) {
      delete process.env.GAME_COMMAND_LOCK_WAIT_MS;
    } else {
      process.env.GAME_COMMAND_LOCK_WAIT_MS = originalWait;
    }

    if (originalRetry === undefined) {
      delete process.env.GAME_COMMAND_LOCK_RETRY_MS;
    } else {
      process.env.GAME_COMMAND_LOCK_RETRY_MS = originalRetry;
    }

    await cleanup(gameId);
  }
});

test('다른 gameId는 동시에 acquire 가능하다', async () => {
  const firstGameId = randomUUID();
  const secondGameId = randomUUID();

  try {
    const [first, second] = await Promise.all([
      service.acquire({ gameId: firstGameId }),
      service.acquire({ gameId: secondGameId }),
    ]);

    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first.token, second.token);
  } finally {
    await Promise.all([cleanup(firstGameId), cleanup(secondGameId)]);
  }
});

test('release()는 같은 token일 때만 lock을 삭제한다', async () => {
  const gameId = randomUUID();
  const lock = await service.acquire({ gameId });

  try {
    assert.ok(lock);

    const wrongRelease = await service.release({
      gameId,
      token: randomUUID(),
    });
    const stillStored = await redisService.getClient().get(lockKey(gameId));

    assert.equal(wrongRelease, false);
    assert.equal(stillStored, lock.token);
  } finally {
    if (lock) {
      await service.release(lock);
    }
    await cleanup(gameId);
  }
});

test('다른 token으로 release하면 삭제하지 않는다', async () => {
  const gameId = randomUUID();
  const lock = await service.acquire({ gameId });

  try {
    assert.ok(lock);

    const released = await service.release({
      gameId,
      token: 'different-token',
    });

    assert.equal(released, false);
    assert.equal(await redisService.getClient().get(lockKey(gameId)), lock.token);
  } finally {
    if (lock) {
      await service.release(lock);
    }
    await cleanup(gameId);
  }
});

test('withLock()은 callback 실행 후 lock을 release한다', async () => {
  const gameId = randomUUID();

  const result = await service.withLock({ gameId }, async () => {
    return 'done';
  });

  assert.equal(result.status, 'ACQUIRED');
  assert.equal(result.value, 'done');
  assert.equal(await redisService.getClient().get(lockKey(gameId)), null);
});

test('callback이 throw해도 lock을 release한다', async () => {
  const gameId = randomUUID();

  await assert.rejects(
    async () =>
      await service.withLock({ gameId }, async () => {
        throw new Error('boom');
      }),
  );

  assert.equal(await redisService.getClient().get(lockKey(gameId)), null);
});

test('TTL이 설정된다', async () => {
  const gameId = randomUUID();

  try {
    const lock = await service.acquire({ gameId });
    assert.ok(lock);

    const ttl = await redisService.getClient().pttl(lockKey(gameId));

    assert.ok(ttl > 0);
  } finally {
    await cleanup(gameId);
  }
});

test('잘못된 TTL env 값이면 기본 TTL을 사용한다', async () => {
  const original = process.env.GAME_COMMAND_LOCK_TTL_MS;
  const gameId = randomUUID();

  try {
    process.env.GAME_COMMAND_LOCK_TTL_MS = '1.5';

    const lock = await service.acquire({ gameId });
    assert.ok(lock);

    const ttl = await redisService.getClient().pttl(lockKey(gameId));

    assert.ok(ttl > 3000);
  } finally {
    if (original === undefined) {
      delete process.env.GAME_COMMAND_LOCK_TTL_MS;
    } else {
      process.env.GAME_COMMAND_LOCK_TTL_MS = original;
    }

    await cleanup(gameId);
  }
});

