import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import {
  ChatMessageCacheService,
  type CachedChatMessage,
} from './chat-message-cache.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const service = new ChatMessageCacheService(redisService);

function keyOf(gameId: string, channel: CachedChatMessage['channel']) {
  return redisService.buildKey(`chat:recent:${gameId}:${channel}`);
}

function createMessage(input: Partial<CachedChatMessage> = {}): CachedChatMessage {
  return {
    type: 'chat:message',
    gameId: input.gameId ?? randomUUID(),
    channel: input.channel ?? 'LOBBY',
    message: input.message ?? 'hello',
    senderUserId:
      input.senderUserId === undefined ? randomUUID() : input.senderUserId,
    sentAt: input.sentAt ?? new Date().toISOString(),
  };
}

async function cleanup(gameId: string, channel: CachedChatMessage['channel']) {
  await redisService.del(`chat:recent:${gameId}:${channel}`);
}

before(async () => {
  await redisService.ping();
});

after(async () => {
  await redisService.onModuleDestroy();
});

test('append() 후 getRecent()로 조회된다', async () => {
  const gameId = randomUUID();
  const message = createMessage({ gameId, channel: 'LOBBY' });

  try {
    await service.append(message);

    const recent = await service.getRecent({ gameId, channel: 'LOBBY' });

    assert.equal(recent.length, 1);
    assert.deepEqual(recent[0], message);
  } finally {
    await cleanup(gameId, 'LOBBY');
  }
});

test('여러 메시지가 오래된 순서에서 최신 순서로 반환된다', async () => {
  const gameId = randomUUID();
  const first = createMessage({ gameId, channel: 'DAY', message: 'first' });
  const second = createMessage({ gameId, channel: 'DAY', message: 'second' });

  try {
    await service.append(first);
    await service.append(second);

    const recent = await service.getRecent({ gameId, channel: 'DAY' });

    assert.deepEqual(recent, [first, second]);
  } finally {
    await cleanup(gameId, 'DAY');
  }
});

test('CHAT_CACHE_LIMIT까지만 유지된다', async () => {
  const original = process.env.CHAT_CACHE_LIMIT;
  const gameId = randomUUID();

  try {
    process.env.CHAT_CACHE_LIMIT = '2';

    const messages = [
      createMessage({ gameId, channel: 'MAFIA', message: 'one' }),
      createMessage({ gameId, channel: 'MAFIA', message: 'two' }),
      createMessage({ gameId, channel: 'MAFIA', message: 'three' }),
    ];

    for (const message of messages) {
      await service.append(message);
    }

    const recent = await service.getRecent({ gameId, channel: 'MAFIA' });

    assert.deepEqual(recent, messages.slice(1));
  } finally {
    if (original === undefined) {
      delete process.env.CHAT_CACHE_LIMIT;
    } else {
      process.env.CHAT_CACHE_LIMIT = original;
    }

    await cleanup(gameId, 'MAFIA');
  }
});

test('getRecent({ limit })은 마지막 limit개만 반환한다', async () => {
  const gameId = randomUUID();
  const messages = [
    createMessage({ gameId, channel: 'GHOST', message: 'one' }),
    createMessage({ gameId, channel: 'GHOST', message: 'two' }),
    createMessage({ gameId, channel: 'GHOST', message: 'three' }),
  ];

  try {
    for (const message of messages) {
      await service.append(message);
    }

    const recent = await service.getRecent({ gameId, channel: 'GHOST', limit: 2 });

    assert.deepEqual(recent, messages.slice(1));
  } finally {
    await cleanup(gameId, 'GHOST');
  }
});

test('TTL이 설정된다', async () => {
  const gameId = randomUUID();
  const message = createMessage({ gameId, channel: 'SYSTEM' });

  try {
    await service.append(message);

    const ttl = await redisService.getClient().ttl(keyOf(gameId, 'SYSTEM'));

    assert.ok(ttl > 0);
  } finally {
    await cleanup(gameId, 'SYSTEM');
  }
});

test('잘못된 CHAT_CACHE_LIMIT이면 기본 limit을 사용한다', async () => {
  const original = process.env.CHAT_CACHE_LIMIT;
  const gameId = randomUUID();

  try {
    process.env.CHAT_CACHE_LIMIT = '1.5';

    await service.append(createMessage({ gameId, channel: 'LOBBY', message: 'one' }));
    await service.append(createMessage({ gameId, channel: 'LOBBY', message: 'two' }));

    const recent = await service.getRecent({ gameId, channel: 'LOBBY' });

    assert.equal(recent.length, 2);
  } finally {
    if (original === undefined) {
      delete process.env.CHAT_CACHE_LIMIT;
    } else {
      process.env.CHAT_CACHE_LIMIT = original;
    }

    await cleanup(gameId, 'LOBBY');
  }
});

test('잘못된 CHAT_CACHE_TTL_SECONDS이면 기본 TTL을 사용한다', async () => {
  const original = process.env.CHAT_CACHE_TTL_SECONDS;
  const gameId = randomUUID();
  const message = createMessage({ gameId, channel: 'DAY' });

  try {
    process.env.CHAT_CACHE_TTL_SECONDS = '10abc';
    await service.append(message);

    const ttl = await redisService.getClient().ttl(keyOf(gameId, 'DAY'));

    assert.ok(ttl > 3000);
  } finally {
    if (original === undefined) {
      delete process.env.CHAT_CACHE_TTL_SECONDS;
    } else {
      process.env.CHAT_CACHE_TTL_SECONDS = original;
    }

    await cleanup(gameId, 'DAY');
  }
});

test('없는 key 조회 시 빈 배열을 반환한다', async () => {
  const gameId = randomUUID();

  assert.deepEqual(
    await service.getRecent({ gameId, channel: 'LOBBY' }),
    [],
  );
});

test('깨진 JSON 항목은 조회에서 제외된다', async () => {
  const gameId = randomUUID();
  const message = createMessage({ gameId, channel: 'MAFIA', message: 'valid' });

  try {
    await redisService.getClient().rpush(keyOf(gameId, 'MAFIA'), 'broken-json');
    await service.append(message);

    const recent = await service.getRecent({ gameId, channel: 'MAFIA' });

    assert.deepEqual(recent, [message]);
  } finally {
    await cleanup(gameId, 'MAFIA');
  }
});
