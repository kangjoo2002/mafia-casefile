import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import {
  ConnectionStateService,
  type RealtimeConnectionState,
} from './connection-state.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const service = new ConnectionStateService(redisService);

function userKey(userId: string) {
  return redisService.buildKey(`connection:user:${userId}`);
}

function socketKey(socketId: string) {
  return redisService.buildKey(`connection:socket:${socketId}`);
}

async function cleanup(state: RealtimeConnectionState | null | undefined) {
  if (!state) {
    return;
  }

  await Promise.all([
    redisService.del(`connection:user:${state.userId}`),
    redisService.del(`connection:socket:${state.socketId}`),
  ]);
}

before(async () => {
  await redisService.ping();
});

after(async () => {
  await redisService.onModuleDestroy();
});

test('markConnected가 user/socket key를 저장한다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });

  try {
    const loaded = await service.findByUserId(state.userId);
    const userId = await service.findUserIdBySocketId(state.socketId);
    const ttl = await redisService.getClient().ttl(userKey(state.userId));

    assert.ok(loaded);
    assert.deepEqual(loaded, state);
    assert.equal(userId, state.userId);
    assert.equal(ttl > 0, true);
  } finally {
    await cleanup(state);
  }
});

test('findByUserId가 연결 상태를 반환한다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });

  try {
    const loaded = await service.findByUserId(state.userId);

    assert.ok(loaded);
    assert.equal(loaded.userId, state.userId);
    assert.equal(loaded.socketId, state.socketId);
    assert.equal(loaded.status, 'CONNECTED');
    assert.equal(loaded.roomId, null);
  } finally {
    await cleanup(state);
  }
});

test('findUserIdBySocketId가 userId를 반환한다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });

  try {
    const userId = await service.findUserIdBySocketId(state.socketId);

    assert.equal(userId, state.userId);
  } finally {
    await cleanup(state);
  }
});

test('setRoom이 roomId를 저장한다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });

  try {
    const updated = await service.setRoom({
      userId: state.userId,
      socketId: state.socketId,
      roomId: randomUUID(),
    });

    assert.equal(updated.status, 'CONNECTED');
    assert.equal(updated.disconnectedAt, null);
    assert.equal(updated.roomId, (await service.findByUserId(state.userId))?.roomId);
  } finally {
    await cleanup(await service.findByUserId(state.userId));
  }
});

test('clearRoom이 같은 roomId일 때만 roomId를 null로 만든다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });
  const roomId = randomUUID();

  try {
    await service.setRoom({
      userId: state.userId,
      socketId: state.socketId,
      roomId,
    });

    const cleared = await service.clearRoom({
      userId: state.userId,
      socketId: state.socketId,
      roomId,
    });

    assert.ok(cleared);
    assert.equal(cleared.roomId, null);
  } finally {
    await cleanup(await service.findByUserId(state.userId));
  }
});

test('clearRoom이 다른 roomId면 기존 roomId를 유지한다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });
  const roomId = randomUUID();
  const otherRoomId = randomUUID();

  try {
    await service.setRoom({
      userId: state.userId,
      socketId: state.socketId,
      roomId,
    });

    const cleared = await service.clearRoom({
      userId: state.userId,
      socketId: state.socketId,
      roomId: otherRoomId,
    });

    assert.ok(cleared);
    assert.equal(cleared.roomId, roomId);
  } finally {
    await cleanup(await service.findByUserId(state.userId));
  }
});

test('markDisconnected가 status를 DISCONNECTED로 바꾸고 roomId는 유지한다', async () => {
  const state = await service.markConnected({
    userId: randomUUID(),
    socketId: randomUUID(),
  });
  const roomId = randomUUID();

  try {
    await service.setRoom({
      userId: state.userId,
      socketId: state.socketId,
      roomId,
    });

    const disconnected = await service.markDisconnected({
      userId: state.userId,
      socketId: state.socketId,
    });

    assert.equal(disconnected.status, 'DISCONNECTED');
    assert.equal(disconnected.roomId, roomId);
    assert.ok(disconnected.disconnectedAt);
  } finally {
    await cleanup(await service.findByUserId(state.userId));
  }
});

test('없는 userId/socketId 조회 시 null을 반환한다', async () => {
  const userId = randomUUID();
  const socketId = randomUUID();

  assert.equal(await service.findByUserId(userId), null);
  assert.equal(await service.findUserIdBySocketId(socketId), null);
});
