import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import { PhaseTimerService } from './phase-timer.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const phaseTimerService = new PhaseTimerService(redisService);

async function cleanup() {
  await redisService.del('phase-timers');
}

before(async () => {
  await redisService.ping();
  await cleanup();
});

after(async () => {
  await cleanup();
  await redisService.onModuleDestroy();
});

test('schedule()은 phase deadline을 Redis에 저장하고 다른 service 인스턴스에서 조회할 수 있다', async () => {
  const otherService = new PhaseTimerService(redisService);
  const entry = {
    gameId: `game-${randomUUID()}`,
    phaseEndsAt: new Date(Date.now() - 1000).toISOString(),
  };

  await phaseTimerService.schedule(entry);

  const due = await otherService.listDue(Date.now());

  assert.deepEqual(due, [entry]);
});

test('같은 gameId를 다시 schedule하면 이전 deadline을 교체한다', async () => {
  const gameId = `game-${randomUUID()}`;
  const oldEntry = {
    gameId,
    phaseEndsAt: new Date(Date.now() - 2000).toISOString(),
  };
  const newEntry = {
    gameId,
    phaseEndsAt: new Date(Date.now() - 1000).toISOString(),
  };

  await phaseTimerService.schedule(oldEntry);
  await phaseTimerService.schedule(newEntry);

  const due = await phaseTimerService.listDue(Date.now());

  assert.equal(due.some((entry) => entry.phaseEndsAt === oldEntry.phaseEndsAt), false);
  assert.equal(due.some((entry) => entry.phaseEndsAt === newEntry.phaseEndsAt), true);
});

test('complete()은 처리 완료된 deadline만 제거한다', async () => {
  const first = {
    gameId: `game-${randomUUID()}`,
    phaseEndsAt: new Date(Date.now() - 2000).toISOString(),
  };
  const second = {
    gameId: `game-${randomUUID()}`,
    phaseEndsAt: new Date(Date.now() - 1000).toISOString(),
  };

  await phaseTimerService.schedule(first);
  await phaseTimerService.schedule(second);
  await phaseTimerService.complete(first);

  const due = await phaseTimerService.listDue(Date.now());

  assert.equal(due.some((entry) => entry.gameId === first.gameId), false);
  assert.equal(due.some((entry) => entry.gameId === second.gameId), true);
});

test('clearGame()은 특정 gameId의 deadline만 제거한다', async () => {
  const cleared = {
    gameId: `game-${randomUUID()}`,
    phaseEndsAt: new Date(Date.now() - 2000).toISOString(),
  };
  const preserved = {
    gameId: `game-${randomUUID()}`,
    phaseEndsAt: new Date(Date.now() - 1000).toISOString(),
  };

  await phaseTimerService.schedule(cleared);
  await phaseTimerService.schedule(preserved);
  await phaseTimerService.clearGame(cleared.gameId);

  const due = await phaseTimerService.listDue(Date.now());

  assert.equal(due.some((entry) => entry.gameId === cleared.gameId), false);
  assert.equal(due.some((entry) => entry.gameId === preserved.gameId), true);
});
