import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import { RedisRoomRepository } from './redis-room.repository';
import type { Room } from './rooms.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const repository = new RedisRoomRepository(redisService);

function createRoom(overrides: Partial<Room> = {}): Room {
  const now = new Date('2026-05-16T12:00:00.000Z');

  return {
    roomId: randomUUID(),
    name: '테스트 방',
    hostUserId: 'host-user',
    status: 'WAITING',
    playerCount: 1,
    maxPlayers: 4,
    participants: [
      {
        userId: 'host-user',
        nickname: 'host',
        isReady: false,
        joinedAt: new Date('2026-05-16T12:01:00.000Z'),
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function cleanup(roomId: string) {
  await redisService.del(`room:${roomId}`);
  await redisService
    .getClient()
    .zrem(redisService.buildKey('rooms:index'), roomId);
}

before(async () => {
  await redisService.ping();
});

after(async () => {
  await redisService.onModuleDestroy();
});

test('save() 후 findById()로 조회할 수 있다', async () => {
  const room = createRoom();

  try {
    const saved = await repository.save(room);
    const loaded = await repository.findById(room.roomId);

    assert.deepEqual(saved, room);
    assert.deepEqual(loaded, room);

    const ttl = await redisService
      .getClient()
      .ttl(redisService.buildKey(`room:${room.roomId}`));
    assert.ok(ttl > 0);
  } finally {
    await cleanup(room.roomId);
  }
});

test('list()는 최신 room을 먼저 반환한다', async () => {
  const first = createRoom({
    roomId: randomUUID(),
    name: 'first',
    createdAt: new Date('2026-05-16T12:00:00.000Z'),
  });
  const second = createRoom({
    roomId: randomUUID(),
    name: 'second',
    createdAt: new Date('2026-05-16T12:01:00.000Z'),
  });

  try {
    await repository.save(first);
    await repository.save(second);

    const rooms = await repository.list();

    assert.equal(rooms[0]?.roomId, second.roomId);
    assert.equal(rooms[1]?.roomId, first.roomId);
  } finally {
    await cleanup(first.roomId);
    await cleanup(second.roomId);
  }
});

test('다른 RedisRoomRepository 인스턴스에서도 저장된 room을 조회할 수 있다', async () => {
  const room = createRoom();
  const otherRepository = new RedisRoomRepository(redisService);

  try {
    await repository.save(room);

    const loaded = await otherRepository.findById(room.roomId);

    assert.deepEqual(loaded, room);
  } finally {
    await cleanup(room.roomId);
  }
});

test('없는 roomId 조회 시 null을 반환한다', async () => {
  const loaded = await repository.findById(randomUUID());

  assert.equal(loaded, null);
});

test('Date 필드가 조회 후 Date instance로 복원된다', async () => {
  const room = createRoom();

  try {
    await repository.save(room);

    const loaded = await repository.findById(room.roomId);

    assert.ok(loaded);
    assert.ok(loaded.createdAt instanceof Date);
    assert.ok(loaded.updatedAt instanceof Date);
    assert.ok(loaded.participants[0]?.joinedAt instanceof Date);
    assert.equal(loaded.createdAt.toISOString(), room.createdAt.toISOString());
    assert.equal(
      loaded.participants[0]?.joinedAt.toISOString(),
      room.participants[0]?.joinedAt.toISOString(),
    );
  } finally {
    await cleanup(room.roomId);
  }
});

test('저장 후 원본 객체를 mutation해도 저장된 room은 바뀌지 않는다', async () => {
  const room = createRoom();

  try {
    await repository.save(room);

    room.name = 'mutated';
    room.participants[0]!.nickname = 'mutated-host';

    const loaded = await repository.findById(room.roomId);

    assert.ok(loaded);
    assert.equal(loaded.name, '테스트 방');
    assert.equal(loaded.participants[0]?.nickname, 'host');
  } finally {
    await cleanup(room.roomId);
  }
});
