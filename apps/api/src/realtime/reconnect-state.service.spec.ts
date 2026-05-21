import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AvailableAction } from '@mafia-casefile/shared';
import { ChatMessageCacheService } from './chat-message-cache.service';
import { AvailableActionsService } from './available-actions.service';
import { ReconnectStateService } from './reconnect-state.service';
import { GameSessionModule } from '../game-session/game-session.module';
import { GameSessionService } from '../game-session/game-session.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;

@Module({
  imports: [GameSessionModule, RedisModule],
  providers: [
    AvailableActionsService,
    ReconnectStateService,
    ChatMessageCacheService,
  ],
})
class ReconnectStateTestModule {}

let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
let redisService: RedisService;
let gameSessionService: GameSessionService;
let reconnectStateService: ReconnectStateService;
let chatMessageCacheService: ChatMessageCacheService;

before(async () => {
  app = await NestFactory.createApplicationContext(ReconnectStateTestModule, {
    logger: false,
  });
  redisService = app.get(RedisService);
  gameSessionService = app.get(GameSessionService);
  reconnectStateService = app.get(ReconnectStateService);
  chatMessageCacheService = app.get(ChatMessageCacheService);
  await redisService.ping();
});

after(async () => {
  await app.close();
});

function createGameId() {
  return randomUUID();
}

function summarize(actions: AvailableAction[]) {
  return actions.map((action) => ({
    type: action.type,
    channel: action.channel,
    targetUserIds: action.targetUserIds,
  }));
}

async function createSession(gameId: string) {
  return await gameSessionService.startGameSession({
    gameId,
    roomId: gameId,
    hostUserId: 'host-user',
    players: [
      {
        userId: 'mafia-user',
        nickname: 'mafia',
        role: 'MAFIA',
      },
      {
        userId: 'doctor-user',
        nickname: 'doctor',
        role: 'DOCTOR',
      },
      {
        userId: 'police-user',
        nickname: 'police',
        role: 'POLICE',
      },
      {
        userId: 'citizen-user',
        nickname: 'citizen',
        role: 'CITIZEN',
      },
    ],
    startedAt: new Date('2026-05-16T12:00:00.000Z'),
  });
}

async function seedRecentChats(gameId: string) {
  await Promise.all([
    chatMessageCacheService.append({
      type: 'chat:message',
      gameId,
      channel: 'LOBBY',
      message: ' lobby ',
      senderUserId: 'mafia-user',
      sentAt: '2026-05-16T12:01:00.000Z',
    }),
    chatMessageCacheService.append({
      type: 'chat:message',
      gameId,
      channel: 'DAY',
      message: ' day ',
      senderUserId: 'doctor-user',
      sentAt: '2026-05-16T12:02:00.000Z',
    }),
    chatMessageCacheService.append({
      type: 'chat:message',
      gameId,
      channel: 'MAFIA',
      message: ' mafia ',
      senderUserId: 'mafia-user',
      sentAt: '2026-05-16T12:03:00.000Z',
    }),
    chatMessageCacheService.append({
      type: 'chat:message',
      gameId,
      channel: 'GHOST',
      message: ' ghost ',
      senderUserId: 'citizen-user',
      sentAt: '2026-05-16T12:04:00.000Z',
    }),
    chatMessageCacheService.append({
      type: 'chat:message',
      gameId,
      channel: 'SYSTEM',
      message: ' system ',
      senderUserId: null,
      sentAt: '2026-05-16T12:05:00.000Z',
    }),
  ]);
}

async function cleanup(gameId: string) {
  await Promise.all([
    redisService.del(`game-session:${gameId}`),
    redisService.del(`chat:recent:${gameId}:LOBBY`),
    redisService.del(`chat:recent:${gameId}:DAY`),
    redisService.del(`chat:recent:${gameId}:MAFIA`),
    redisService.del(`chat:recent:${gameId}:GHOST`),
    redisService.del(`chat:recent:${gameId}:SYSTEM`),
  ]);
}

test('previousRoomId가 null이면 NO_ROOM', async () => {
  const result = await reconnectStateService.buildReconnectState({
    userId: randomUUID(),
    previousRoomId: null,
  });

  assert.equal(result.restored, false);
  assert.equal(result.reason, 'NO_ROOM');
  assert.equal(result.roomId, null);
  assert.equal(result.gameId, null);
  assert.equal(result.session, null);
  assert.equal(result.player, null);
  assert.deepEqual(result.recentChats, []);
  assert.deepEqual(result.availableActions, []);
});

test('previousRoomId가 있지만 session이 없으면 GAME_SESSION_NOT_FOUND', async () => {
  const previousRoomId = createGameId();

  const result = await reconnectStateService.buildReconnectState({
    userId: randomUUID(),
    previousRoomId,
  });

  assert.equal(result.restored, false);
  assert.equal(result.reason, 'GAME_SESSION_NOT_FOUND');
  assert.equal(result.roomId, previousRoomId);
  assert.equal(result.gameId, previousRoomId);
  assert.equal(result.session, null);
  assert.equal(result.player, null);
  assert.deepEqual(result.recentChats, []);
  assert.deepEqual(result.availableActions, []);
});

test('session이 있고 player가 있으면 RESTORED', async () => {
  const gameId = createGameId();

  try {
    await createSession(gameId);
    await seedRecentChats(gameId);

    const result = await reconnectStateService.buildReconnectState({
      userId: 'mafia-user',
      previousRoomId: gameId,
    });

    assert.equal(result.restored, true);
    assert.equal(result.reason, 'RESTORED');
    assert.equal(result.roomId, gameId);
    assert.equal(result.gameId, gameId);
    assert.ok(result.session);
    assert.ok(result.player);
    assert.deepEqual(summarize(result.availableActions), [
      {
        type: 'SELECT_MAFIA_TARGET',
        channel: undefined,
        targetUserIds: ['doctor-user', 'police-user', 'citizen-user'],
      },
      {
        type: 'SEND_CHAT_MESSAGE',
        channel: 'MAFIA',
        targetUserIds: undefined,
      },
    ]);

    const channels = result.recentChats.map((entry) => entry.channel);
    assert.deepEqual(channels, ['LOBBY', 'DAY', 'MAFIA']);
    assert.equal(result.recentChats.some((entry) => entry.channel === 'SYSTEM'), false);
  } finally {
    await cleanup(gameId);
  }
});

test('session이 있고 player가 없으면 PLAYER_NOT_IN_GAME', async () => {
  const gameId = createGameId();

  try {
    await createSession(gameId);

    const result = await reconnectStateService.buildReconnectState({
      userId: 'outsider-user',
      previousRoomId: gameId,
    });

    assert.equal(result.restored, false);
    assert.equal(result.reason, 'PLAYER_NOT_IN_GAME');
    assert.equal(result.roomId, gameId);
    assert.equal(result.gameId, gameId);
    assert.ok(result.session);
    assert.equal(result.player, null);
    assert.deepEqual(result.recentChats, []);
    assert.deepEqual(result.availableActions, []);
  } finally {
    await cleanup(gameId);
  }
});

test('alive non-mafia player는 MAFIA recent chat을 받지 않는다', async () => {
  const gameId = createGameId();

  try {
    await createSession(gameId);
    await seedRecentChats(gameId);

    const result = await reconnectStateService.buildReconnectState({
      userId: 'doctor-user',
      previousRoomId: gameId,
    });

    const channels = result.recentChats.map((entry) => entry.channel);

    assert.deepEqual(channels, ['LOBBY', 'DAY']);
    assert.equal(channels.includes('MAFIA'), false);
    assert.equal(channels.includes('GHOST'), false);
    assert.deepEqual(result.availableActions, [
      {
        type: 'SELECT_DOCTOR_TARGET',
        targetUserIds: ['mafia-user', 'police-user', 'citizen-user'],
      },
    ]);
  } finally {
    await cleanup(gameId);
  }
});

test('VOTING phase alive player reconnect는 CAST_VOTE를 받는다', async () => {
  const gameId = createGameId();

  try {
    await createSession(gameId);
    await gameSessionService.advancePhase(gameId);
    await gameSessionService.advancePhase(gameId);

    const result = await reconnectStateService.buildReconnectState({
      userId: 'doctor-user',
      previousRoomId: gameId,
    });

    assert.deepEqual(result.availableActions, [
      {
        type: 'CAST_VOTE',
        targetUserIds: ['mafia-user', 'doctor-user', 'police-user', 'citizen-user'],
      },
    ]);
  } finally {
    await cleanup(gameId);
  }
});

test('dead player는 GHOST recent chat을 받는다', async () => {
  const gameId = createGameId();

  try {
    await createSession(gameId);
    await seedRecentChats(gameId);
    await gameSessionService.selectMafiaTarget(
      gameId,
      'mafia-user',
      'citizen-user',
    );
    await gameSessionService.selectDoctorTarget(
      gameId,
      'doctor-user',
      'police-user',
    );
    await gameSessionService.resolveNightOutcome(gameId);

    const result = await reconnectStateService.buildReconnectState({
      userId: 'citizen-user',
      previousRoomId: gameId,
    });

    const channels = result.recentChats.map((entry) => entry.channel);

    assert.deepEqual(channels, ['LOBBY', 'DAY', 'GHOST']);
    assert.equal(channels.includes('MAFIA'), false);
    assert.equal(channels.includes('SYSTEM'), false);
    assert.deepEqual(result.availableActions, [
      {
        type: 'SEND_CHAT_MESSAGE',
        channel: 'GHOST',
      },
    ]);
  } finally {
    await cleanup(gameId);
  }
});
