import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import { RequestIdempotencyService } from './request-idempotency.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const service = new RequestIdempotencyService(redisService);

function keyOf(input: { gameId: string; userId: string; requestId: string }) {
  return `idempotency:${input.gameId}:${input.userId}:${input.requestId}`;
}

async function cleanup(input: {
  gameId: string;
  userId: string;
  requestId: string;
}) {
  await redisService.del(keyOf(input));
}

async function createBaseInput() {
  return {
    gameId: randomUUID(),
    userId: randomUUID(),
    requestId: randomUUID(),
    commandType: 'JOIN_ROOM',
  };
}

before(async () => {
  await redisService.ping();
});

after(async () => {
  await redisService.onModuleDestroy();
});

test('begin() 첫 호출은 ACQUIRED', async () => {
  const input = await createBaseInput();

  try {
    const result = await service.begin(input);

    assert.equal(result.status, 'ACQUIRED');
    assert.equal(result.record.status, 'PROCESSING');
    assert.equal(result.record.commandType, input.commandType);
    assert.equal(result.record.requestId, input.requestId);
  } finally {
    await cleanup(input);
  }
});

test('같은 key로 다시 begin하면 DUPLICATE_PROCESSING', async () => {
  const input = await createBaseInput();

  try {
    await service.begin(input);
    const result = await service.begin(input);

    assert.equal(result.status, 'DUPLICATE_PROCESSING');
    assert.equal(result.record.status, 'PROCESSING');
  } finally {
    await cleanup(input);
  }
});

test('completeAccepted() 후 다시 begin하면 DUPLICATE_COMPLETED', async () => {
  const input = await createBaseInput();

  try {
    await service.begin(input);
    const completed = await service.completeAccepted({
      ...input,
      receivedType: input.commandType,
    });
    const result = await service.begin(input);

    assert.equal(result.status, 'DUPLICATE_COMPLETED');
    assert.equal(result.record.status, 'COMPLETED');
    assert.equal(result.record.resultType, 'COMMAND_ACCEPTED');
    assert.equal(completed.resultType, 'COMMAND_ACCEPTED');
    assert.equal(completed.receivedType, input.commandType);
  } finally {
    await cleanup(input);
  }
});

test('completeRejected() 후 다시 begin하면 DUPLICATE_COMPLETED', async () => {
  const input = await createBaseInput();

  try {
    await service.begin(input);
    const completed = await service.completeRejected({
      ...input,
      reason: 'ROOM_NOT_FOUND',
      message: 'room not found',
    });
    const result = await service.begin(input);

    assert.equal(result.status, 'DUPLICATE_COMPLETED');
    assert.equal(result.record.status, 'COMPLETED');
    assert.equal(result.record.resultType, 'COMMAND_REJECTED');
    assert.equal(completed.reason, 'ROOM_NOT_FOUND');
    assert.equal(completed.message, 'room not found');
  } finally {
    await cleanup(input);
  }
});

test('TTL이 설정된다', async () => {
  const input = await createBaseInput();

  try {
    await service.begin(input);

    const ttl = await redisService.getClient().ttl(
      redisService.buildKey(keyOf(input)),
    );

    assert.ok(ttl > 0);
  } finally {
    await cleanup(input);
  }
});

test('잘못된 REQUEST_ID_TTL_SECONDS면 기본 TTL을 사용한다', async () => {
  const original = process.env.REQUEST_ID_TTL_SECONDS;
  const input = await createBaseInput();

  try {
    process.env.REQUEST_ID_TTL_SECONDS = '1.5';
    await service.begin(input);

    const ttl = await redisService.getClient().ttl(
      redisService.buildKey(keyOf(input)),
    );

    assert.ok(ttl > 1);
  } finally {
    if (original === undefined) {
      delete process.env.REQUEST_ID_TTL_SECONDS;
    } else {
      process.env.REQUEST_ID_TTL_SECONDS = original;
    }

    await cleanup(input);
  }
});

test('없는 key find()는 null을 반환한다', async () => {
  const input = await createBaseInput();

  assert.equal(
    await service.find({
      gameId: input.gameId,
      userId: input.userId,
      requestId: input.requestId,
    }),
    null,
  );
});
