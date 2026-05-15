import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from './redis.service';

const redisService = new RedisService();
const keySuffix = randomUUID();
const plainKey = `test:${keySuffix}:plain`;
const ttlKey = `test:${keySuffix}:ttl`;

before(async () => {
  await redisService.ping();
});

after(async () => {
  await Promise.allSettled([redisService.del(plainKey), redisService.del(ttlKey)]);
  await redisService.onModuleDestroy();
});

test('ping succeeds', async () => {
  const response = await redisService.ping();

  assert.equal(response, 'PONG');
});

test('buildKey applies the prefix', () => {
  assert.equal(
    redisService.buildKey('test', 'read-write'),
    'mafia-casefile:test:read-write',
  );
});

test('set/get succeeds', async () => {
  await redisService.set(plainKey, 'plain-value');

  const value = await redisService.get(plainKey);
  assert.equal(value, 'plain-value');
});

test('set/get with ttl succeeds', async () => {
  await redisService.set(ttlKey, 'ttl-value', 30);

  const value = await redisService.get(ttlKey);
  assert.equal(value, 'ttl-value');
});

test('del succeeds', async () => {
  await redisService.set(plainKey, 'delete-me');

  const deleted = await redisService.del(plainKey);
  assert.equal(deleted, 1);

  const value = await redisService.get(plainKey);
  assert.equal(value, null);
});
