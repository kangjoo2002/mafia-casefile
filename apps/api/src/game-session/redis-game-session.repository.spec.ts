import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { RedisService } from '../redis/redis.service';
import { RedisGameSessionRepository } from './redis-game-session.repository';
import type { GameSession } from './game-session';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

const redisService = new RedisService();
const repository = new RedisGameSessionRepository(redisService);

function createSession(overrides: Partial<GameSession> = {}): GameSession {
  const baseTime = new Date('2026-05-16T12:00:00.000Z');
  return {
    gameId: randomUUID(),
    roomId: randomUUID(),
    phase: 'WAITING',
    turn: 0,
    version: 1,
    hostUserId: 'host-user',
    players: [
      {
        userId: 'user-1',
        nickname: 'alpha',
        role: 'MAFIA',
        status: 'ALIVE',
        connectionStatus: 'CONNECTED',
        lastSeenAt: new Date('2026-05-16T12:01:00.000Z'),
      },
      {
        userId: 'user-2',
        nickname: 'bravo',
        role: 'DOCTOR',
        status: 'ALIVE',
        connectionStatus: 'CONNECTED',
        lastSeenAt: new Date('2026-05-16T12:02:00.000Z'),
      },
      {
        userId: 'user-3',
        nickname: 'charlie',
        role: 'POLICE',
        status: 'ALIVE',
        connectionStatus: 'CONNECTED',
        lastSeenAt: new Date('2026-05-16T12:03:00.000Z'),
      },
      {
        userId: 'user-4',
        nickname: 'delta',
        role: 'CITIZEN',
        status: 'ALIVE',
        connectionStatus: 'CONNECTED',
        lastSeenAt: new Date('2026-05-16T12:04:00.000Z'),
      },
    ],
    votes: {
      'user-2': 'user-4',
    },
    nightActions: {
      mafiaTarget: 'user-4',
      doctorTarget: 'user-1',
      policeTarget: 'user-1',
    },
    phaseEndsAt: new Date('2026-05-16T12:10:00.000Z'),
    processedRequests: {
      'req-1': 'user-4',
    },
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

async function cleanup(gameId: string) {
  await redisService.del(`game-session:${gameId}`);
}

before(async () => {
  await redisService.ping();
});

after(async () => {
  await redisService.onModuleDestroy();
});

test('save() 후 findByGameId()로 조회할 수 있다', async () => {
  const session = createSession();

  try {
    const saved = await repository.save(session);
    const loaded = await repository.findByGameId(session.gameId);

    assert.deepEqual(saved, session);
    assert.deepEqual(loaded, session);
    const ttl = await redisService
      .getClient()
      .ttl(redisService.buildKey(`game-session:${session.gameId}`));
    assert.ok(ttl > 0);
  } finally {
    await cleanup(session.gameId);
  }
});

test('잘못된 TTL 값이면 기본 TTL을 사용한다', async () => {
  const originalTtl = process.env.GAME_SESSION_TTL_SECONDS;
  const session = createSession();

  try {
    process.env.GAME_SESSION_TTL_SECONDS = '1.5';

    await repository.save(session);

    const ttl = await redisService
      .getClient()
      .ttl(redisService.buildKey(`game-session:${session.gameId}`));

    assert.ok(ttl > 0);
    assert.ok(ttl <= 86400);
  } finally {
    if (originalTtl === undefined) {
      delete process.env.GAME_SESSION_TTL_SECONDS;
    } else {
      process.env.GAME_SESSION_TTL_SECONDS = originalTtl;
    }
    await cleanup(session.gameId);
  }
});

test('없는 gameId 조회 시 null을 반환한다', async () => {
  const gameId = randomUUID();

  const loaded = await repository.findByGameId(gameId);

  assert.equal(loaded, null);
});

test('Date 필드가 조회 후 Date instance로 복원된다', async () => {
  const session = createSession({
    phaseEndsAt: new Date('2026-05-16T12:20:00.000Z'),
  });

  try {
    await repository.save(session);

    const loaded = await repository.findByGameId(session.gameId);

    assert.ok(loaded);
    assert.ok(loaded.createdAt instanceof Date);
    assert.ok(loaded.updatedAt instanceof Date);
    assert.ok(loaded.phaseEndsAt instanceof Date);
    assert.ok(loaded.players[0]?.lastSeenAt instanceof Date);
    assert.ok(loaded.players[1]?.lastSeenAt instanceof Date);
    assert.ok(loaded.players[2]?.lastSeenAt instanceof Date);
    assert.ok(loaded.players[3]?.lastSeenAt instanceof Date);
    assert.equal(loaded.phaseEndsAt?.toISOString(), '2026-05-16T12:20:00.000Z');
  } finally {
    await cleanup(session.gameId);
  }
});

test('phaseEndsAt = null이면 조회 후에도 null이다', async () => {
  const session = createSession({
    phaseEndsAt: null,
  });

  try {
    await repository.save(session);

    const loaded = await repository.findByGameId(session.gameId);

    assert.ok(loaded);
    assert.equal(loaded.phaseEndsAt, null);
  } finally {
    await cleanup(session.gameId);
  }
});

test('저장 후 원본 객체를 mutation해도 저장된 session은 바뀌지 않는다', async () => {
  const session = createSession();

  try {
    await repository.save(session);

    session.phase = 'DAY_DISCUSSION';
    session.turn = 7;
    session.players[0]!.nickname = 'mutated';
    session.players[0]!.lastSeenAt = new Date('2026-05-16T23:59:59.000Z');
    session.phaseEndsAt = null;
    session.votes['user-5'] = 'user-1';

    const loaded = await repository.findByGameId(session.gameId);

    assert.ok(loaded);
    assert.equal(loaded.phase, 'WAITING');
    assert.equal(loaded.turn, 0);
    assert.equal(loaded.players[0]?.nickname, 'alpha');
    assert.equal(loaded.players[0]?.lastSeenAt.toISOString(), '2026-05-16T12:01:00.000Z');
    assert.equal(loaded.phaseEndsAt?.toISOString(), '2026-05-16T12:10:00.000Z');
    assert.equal(loaded.votes['user-5'], undefined);
  } finally {
    await cleanup(session.gameId);
  }
});

test('조회한 객체를 mutation한 뒤 다시 조회해도 저장된 session은 바뀌지 않는다', async () => {
  const session = createSession();

  try {
    await repository.save(session);

    const loaded = await repository.findByGameId(session.gameId);
    assert.ok(loaded);

    loaded.phase = 'DAY_DISCUSSION';
    loaded.players[1]!.nickname = 'mutated';
    loaded.players[1]!.lastSeenAt = new Date('2026-05-16T22:22:22.000Z');
    loaded.phaseEndsAt = null;

    const reloaded = await repository.findByGameId(session.gameId);

    assert.ok(reloaded);
    assert.equal(reloaded.phase, 'WAITING');
    assert.equal(reloaded.players[1]?.nickname, 'bravo');
    assert.equal(reloaded.players[1]?.lastSeenAt.toISOString(), '2026-05-16T12:02:00.000Z');
    assert.equal(reloaded.phaseEndsAt?.toISOString(), '2026-05-16T12:10:00.000Z');
  } finally {
    await cleanup(session.gameId);
  }
});

test('같은 gameId로 다시 save하면 기존 session을 overwrite한다', async () => {
  const session = createSession();

  try {
    await repository.save(session);

    const updated: GameSession = {
      ...session,
      phase: 'DAY_DISCUSSION',
      turn: 2,
      version: 2,
      phaseEndsAt: null,
      updatedAt: new Date('2026-05-16T12:30:00.000Z'),
      players: session.players.map((player, index) => ({
        ...player,
        nickname: `${player.nickname}-${index}`,
      })),
      votes: {
        'user-1': 'user-2',
      },
      nightActions: {
        mafiaTarget: 'user-2',
      },
      processedRequests: {
        'req-2': 'user-2',
      },
    };

    await repository.save(updated);

    const loaded = await repository.findByGameId(session.gameId);

    assert.deepEqual(loaded, updated);
  } finally {
    await cleanup(session.gameId);
  }
});
