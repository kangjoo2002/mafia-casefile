import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type {
  ChatMessageEvent,
  ReconnectStateEvent,
} from '@mafia-casefile/shared';
import { JwtService } from '../auth/jwt.service';
import { GameSessionService } from '../game-session/game-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { ConnectionStateService } from './connection-state.service';
import { RedisService } from '../redis/redis.service';
import { RequestIdempotencyService } from './request-idempotency.service';
import { RealtimeModule } from './realtime.module';
import { io, Socket } from 'socket.io-client';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.REDIS_KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX ?? `mafia-casefile-test-${randomUUID()}`;
process.env.DATABASE_URL ??=
  'postgresql://mafia:mafia_password@localhost:5432/mafia_casefile';

let app: Awaited<ReturnType<typeof NestFactory.create>>;
const prisma = new PrismaService();
let roomsService: RoomsService;
let gameSessionService: GameSessionService;
let connectionStateService: ConnectionStateService;
let redisService: RedisService;
let requestIdempotencyService: RequestIdempotencyService;

@Module({
  imports: [RealtimeModule],
})
class RealtimeTestModule {}

type CommandResponse = {
  type: string;
  requestId: string;
  receivedType?: string;
  reason?: string;
  message?: string;
};

type StartedContext = {
  room: ReturnType<RoomsService['createRoom']>;
  session: Awaited<ReturnType<GameSessionService['findByGameId']>>;
  socketsByUserId: Map<string, Socket>;
  sockets: Socket[];
  players: {
    host: { userId: string; socket: Socket };
    guest1: { userId: string; socket: Socket };
    guest2: { userId: string; socket: Socket };
    guest3: { userId: string; socket: Socket };
  };
};

function getUrl() {
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test port');
  }

  return `http://127.0.0.1:${address.port}`;
}

function connectClient(auth: { token: string }, autoConnect = true) {
  const socket = io(getUrl(), {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: false,
    auth,
  });

  socket.auth = auth;
  (socket.io.opts as any).auth = auth;

  if (autoConnect) {
    socket.connect();
  }

  return socket;
}

async function waitForConnect(socket: Socket) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('connection timed out'));
    }, 5000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
  });
}

async function waitForEvent<T>(
  socket: Socket,
  eventName: string,
  timeoutMs = 5000,
) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`${eventName} timed out`));
    }, timeoutMs);

    const handler = (message: T) => {
      clearTimeout(timeout);
      resolve(message);
    };

    socket.once(eventName, handler);
  });
}

async function waitForConnectionState(
  userId: string,
  predicate: (state: { status: string; roomId: string | null } | null) => boolean,
  timeoutMs = 5000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await connectionStateService.findByUserId(userId);

    if (predicate(state)) {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`connection state for ${userId} timed out`);
}

async function sendCommandAndWait<T>(socket: Socket, command: unknown) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('command response timed out'));
    }, 5000);

    const acceptedHandler = (message: T) => {
      clearTimeout(timeout);
      socket.off('command:rejected', rejectedHandler);
      resolve(message);
    };

    const rejectedHandler = (message: T) => {
      clearTimeout(timeout);
      socket.off('command:accepted', acceptedHandler);
      resolve(message);
    };

    socket.once('command:accepted', acceptedHandler);
    socket.once('command:rejected', rejectedHandler);
    socket.emit('command', command);
  });
}

function buildAuthedSocket(userId: string) {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: userId,
    email: `${userId}@example.com`,
  });

  return {
    userId,
    socket: connectClient({ token }),
  };
}

function joinRoomCommand(
  socket: Socket,
  roomId: string,
  nickname: string,
  requestId: string,
) {
  return sendCommandAndWait<CommandResponse>(socket, {
    type: 'JOIN_ROOM',
    requestId,
    gameId: roomId,
    payload: {
      nickname,
    },
  });
}

function readyRoomCommand(
  socket: Socket,
  roomId: string,
  isReady: boolean,
  requestId: string,
) {
  return sendCommandAndWait<CommandResponse>(socket, {
    type: 'CHANGE_READY',
    requestId,
    gameId: roomId,
    payload: {
      isReady,
    },
  });
}

function startGameCommand(socket: Socket, roomId: string, requestId: string) {
  return sendCommandAndWait<CommandResponse>(socket, {
    type: 'START_GAME',
    requestId,
    gameId: roomId,
    payload: {},
  });
}

function nextPhaseCommand(socket: Socket, roomId: string, requestId: string) {
  return sendCommandAndWait<CommandResponse>(socket, {
    type: 'NEXT_PHASE',
    requestId,
    gameId: roomId,
    payload: {},
  });
}

function voteCommand(
  socket: Socket,
  roomId: string,
  targetUserId: string,
  requestId: string,
) {
  return sendCommandAndWait<CommandResponse>(socket, {
    type: 'CAST_VOTE',
    requestId,
    gameId: roomId,
    payload: {
      targetUserId,
    },
  });
}

function chatCommand(
  socket: Socket,
  roomId: string,
  channel: 'LOBBY' | 'DAY' | 'MAFIA' | 'GHOST',
  message: string,
  requestId: string,
) {
  return sendCommandAndWait<CommandResponse>(socket, {
    type: 'SEND_CHAT_MESSAGE',
    requestId,
    gameId: roomId,
    payload: {
      channel,
      message,
    },
  });
}

function createSessionPlayers(prefix: string) {
  return {
    host: buildAuthedSocket(`${prefix}-host`),
    guest1: buildAuthedSocket(`${prefix}-guest-1`),
    guest2: buildAuthedSocket(`${prefix}-guest-2`),
    guest3: buildAuthedSocket(`${prefix}-guest-3`),
  };
}

async function createStartedGameContext(prefix: string): Promise<StartedContext> {
  const players = createSessionPlayers(prefix);

  await Promise.all([
    waitForConnect(players.host.socket),
    waitForConnect(players.guest1.socket),
    waitForConnect(players.guest2.socket),
    waitForConnect(players.guest3.socket),
  ]);

  const room = roomsService.createRoom({
    hostUserId: players.host.userId,
    name: `${prefix}-room`,
  });

  await joinRoomCommand(players.host.socket, room.roomId, 'host', `${prefix}-join-host`);
  await joinRoomCommand(players.guest1.socket, room.roomId, 'guest1', `${prefix}-join-1`);
  await joinRoomCommand(players.guest2.socket, room.roomId, 'guest2', `${prefix}-join-2`);
  await joinRoomCommand(players.guest3.socket, room.roomId, 'guest3', `${prefix}-join-3`);

  await readyRoomCommand(players.host.socket, room.roomId, true, `${prefix}-ready-host`);
  await readyRoomCommand(players.guest1.socket, room.roomId, true, `${prefix}-ready-1`);
  await readyRoomCommand(players.guest2.socket, room.roomId, true, `${prefix}-ready-2`);
  await readyRoomCommand(players.guest3.socket, room.roomId, true, `${prefix}-ready-3`);

  const startResponse = await startGameCommand(players.host.socket, room.roomId, `${prefix}-start`);
  assert.equal(startResponse.type, 'COMMAND_ACCEPTED');

  const session = await gameSessionService.findByGameId(room.roomId);
  assert.ok(session);

  return {
    room,
    session,
    socketsByUserId: new Map<string, Socket>([
      [players.host.userId, players.host.socket],
      [players.guest1.userId, players.guest1.socket],
      [players.guest2.userId, players.guest2.socket],
      [players.guest3.userId, players.guest3.socket],
    ]),
    sockets: [
      players.host.socket,
      players.guest1.socket,
      players.guest2.socket,
      players.guest3.socket,
    ],
    players,
  };
}

async function cleanupGame(gameId: string) {
  await Promise.all([
    prisma.gameEventLog.deleteMany({ where: { gameId } }).catch(() => undefined),
    redisService.del(`game-session:${gameId}`),
    redisService.del(`chat:recent:${gameId}:LOBBY`),
    redisService.del(`chat:recent:${gameId}:DAY`),
    redisService.del(`chat:recent:${gameId}:MAFIA`),
    redisService.del(`chat:recent:${gameId}:GHOST`),
    redisService.del(`chat:recent:${gameId}:SYSTEM`),
    redisService.del(`lock:game:${gameId}`),
  ]);
}

async function cleanupConnectionState(
  entries: Array<{ socket: Socket; userId: string }>,
) {
  await Promise.all(
    entries.flatMap((entry) => [
      redisService.del(`connection:user:${entry.userId}`),
      redisService.del(`connection:socket:${entry.socket.id}`),
    ]),
  );
}

async function cleanupIdempotency(input: {
  gameId: string;
  userId: string;
  requestId: string;
}) {
  await redisService.del(
    `idempotency:${input.gameId}:${input.userId}:${input.requestId}`,
  );
}

before(async () => {
  await prisma.$connect();
  app = await NestFactory.create(RealtimeTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');

  roomsService = app.get(RoomsService);
  gameSessionService = app.get(GameSessionService);
  connectionStateService = app.get(ConnectionStateService);
  redisService = app.get(RedisService);
  requestIdempotencyService = app.get(RequestIdempotencyService);
  await redisService.ping();
});

after(async () => {
  await prisma.$disconnect();
  await app.close();
});

test('reconnect restores room, session, player, recentChats, availableActions', async () => {
  const context = await createStartedGameContext(`reconnect-${randomUUID()}`);
  let reconnectUserId = '';
  let reconnectingSocket: Socket | undefined;

  try {
    const reconnectUser = context.session?.players.find(
      (player) => player.userId !== context.players.host.userId && player.role !== 'MAFIA',
    );
    assert.ok(reconnectUser);
    reconnectUserId = reconnectUser!.userId;

    const reconnectSocket = context.socketsByUserId.get(reconnectUser!.userId);
    assert.ok(reconnectSocket);

    const sender = context.session?.players.find(
      (player) => player.userId !== reconnectUser!.userId,
    );
    assert.ok(sender);

    const senderSocket = context.socketsByUserId.get(sender!.userId);
    assert.ok(senderSocket);

    await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      `${context.room.roomId}-to-day`,
    );

    const preChatResponse = await chatCommand(
      senderSocket!,
      context.room.roomId,
      'DAY',
      '  day hello  ',
      `${context.room.roomId}-day-chat-1`,
    );

    assert.equal(preChatResponse.type, 'COMMAND_ACCEPTED');

    const countBeforeReconnect = await prisma.gameEventLog.count({
      where: {
        gameId: context.room.roomId,
      },
    });

    reconnectSocket!.disconnect();
    await waitForConnectionState(
      reconnectUserId,
      (state) =>
        state?.status === 'DISCONNECTED' &&
        state.roomId === context.room.roomId,
    );

    reconnectingSocket = connectClient({
      token: new JwtService().signAccessToken({
        id: reconnectUser!.userId,
        email: `${reconnectUser!.userId}@example.com`,
      }),
    }, false);

    try {
      const reconnectStatePromise = waitForEvent<ReconnectStateEvent>(
        reconnectingSocket,
        'reconnect:state',
        5000,
      );

      reconnectingSocket.connect();

      const reconnectState = await reconnectStatePromise;

      assert.equal(reconnectState.type, 'reconnect:state');
      assert.equal(reconnectState.restored, true);
      assert.equal(reconnectState.reason, 'RESTORED');
      assert.equal(reconnectState.roomId, context.room.roomId);
      assert.equal(reconnectState.gameId, context.room.roomId);
      assert.ok(reconnectState.session);
      assert.ok(reconnectState.player);
      assert.ok(Array.isArray(reconnectState.recentChats));
      assert.ok(Array.isArray(reconnectState.availableActions));

      const session = reconnectState.session as {
        gameId: string;
        players: Array<{ userId: string; connectionStatus: string }>;
      };
      const player = reconnectState.player as {
        userId: string;
        connectionStatus: string;
      };

      assert.equal(session.gameId, context.room.roomId);
      assert.equal(player.userId, reconnectUser!.userId);
      assert.equal(player.connectionStatus, 'CONNECTED');
      assert.deepEqual(
        reconnectState.recentChats.map((entry) => entry.channel),
        ['LOBBY', 'DAY'],
      );

      const daySnapshot = reconnectState.recentChats.find(
        (entry) => entry.channel === 'DAY',
      );
      assert.ok(daySnapshot);
      assert.ok(daySnapshot?.messages.some((message) => message.message === 'day hello'));

      assert.deepEqual(reconnectState.availableActions, [
        {
          type: 'SEND_CHAT_MESSAGE',
          channel: 'DAY',
        },
      ]);

      const countAfterReconnect = await prisma.gameEventLog.count({
        where: {
          gameId: context.room.roomId,
        },
      });

      assert.equal(countAfterReconnect, countBeforeReconnect);

      const broadcastPromise = waitForEvent<ChatMessageEvent>(
        reconnectingSocket,
        'chat:message',
        5000,
      );

      const secondChatResponse = await chatCommand(
        senderSocket!,
        context.room.roomId,
        'DAY',
        '  after reconnect  ',
        `${context.room.roomId}-day-chat-2`,
      );

      assert.equal(secondChatResponse.type, 'COMMAND_ACCEPTED');

      const broadcast = await broadcastPromise;
      assert.equal(broadcast.channel, 'DAY');
      assert.equal(broadcast.message, 'after reconnect');
      assert.equal(broadcast.senderUserId, sender!.userId);
    } finally {
      reconnectingSocket?.disconnect();
    }
  } finally {
    for (const socket of context.sockets) {
      socket.disconnect();
    }

    await cleanupGame(context.room.roomId);
    await cleanupConnectionState([
      { socket: context.players.host.socket, userId: context.players.host.userId },
      { socket: context.players.guest1.socket, userId: context.players.guest1.userId },
      { socket: context.players.guest2.socket, userId: context.players.guest2.userId },
      { socket: context.players.guest3.socket, userId: context.players.guest3.userId },
      ...(reconnectingSocket
        ? [{ socket: reconnectingSocket, userId: reconnectUserId }]
        : []),
    ]);
  }
});

test('duplicate completed accepted JOIN_ROOM does not duplicate state or event', async () => {
  const roomsServiceLocal = app.get(RoomsService);
  const player = buildAuthedSocket(`dup-join-${randomUUID()}`);

  await waitForConnect(player.socket);

  const room = roomsServiceLocal.createRoom({
    hostUserId: player.userId,
    name: `dup-join-room-${randomUUID()}`,
  });

  try {
    const firstResponse = await joinRoomCommand(
      player.socket,
      room.roomId,
      'alpha',
      `${room.roomId}-join`,
    );
    const secondResponse = await joinRoomCommand(
      player.socket,
      room.roomId,
      'alpha',
      `${room.roomId}-join`,
    );

    assert.equal(firstResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(secondResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(firstResponse.requestId, secondResponse.requestId);

    const refreshedRoom = roomsServiceLocal.findRoomById(room.roomId);
    assert.ok(refreshedRoom);
    assert.equal(refreshedRoom?.participants.length, 1);

    const eventCount = await prisma.gameEventLog.count({
      where: {
        gameId: room.roomId,
        type: 'PlayerJoined',
        requestId: `${room.roomId}-join`,
      },
    });

    assert.equal(eventCount, 1);

    const idempotency = await requestIdempotencyService.find({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-join`,
    });

    assert.ok(idempotency);
    assert.equal(idempotency?.status, 'COMPLETED');
    assert.equal(idempotency?.resultType, 'COMMAND_ACCEPTED');
  } finally {
    player.socket.disconnect();
    await cleanupGame(room.roomId);
    await cleanupIdempotency({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-join`,
    });
    await cleanupConnectionState([{ socket: player.socket, userId: player.userId }]);
  }
});

test('duplicate completed CAST_VOTE does not duplicate vote or event', async () => {
  const context = await createStartedGameContext(`dup-vote-${randomUUID()}`);
  const session = context.session!;
  const voter = session.players.find(
    (player) => player.userId !== context.players.host.userId && player.status === 'ALIVE',
  );
  const firstTarget = session.players.find(
    (player) => player.userId !== voter?.userId && player.status === 'ALIVE',
  );
  const secondTarget = session.players.find(
    (player) =>
      player.userId !== voter?.userId &&
      player.userId !== firstTarget?.userId &&
      player.status === 'ALIVE',
  );

  assert.ok(voter);
  assert.ok(firstTarget);
  assert.ok(secondTarget);

  try {
    await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      `${context.room.roomId}-to-day`,
    );
    await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      `${context.room.roomId}-to-voting`,
    );

    const voterSocket = context.socketsByUserId.get(voter!.userId);
    assert.ok(voterSocket);

    const firstResponse = await voteCommand(
      voterSocket!,
      context.room.roomId,
      firstTarget!.userId,
      `${context.room.roomId}-vote`,
    );
    const secondResponse = await voteCommand(
      voterSocket!,
      context.room.roomId,
      secondTarget!.userId,
      `${context.room.roomId}-vote`,
    );

    assert.equal(firstResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(secondResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(firstResponse.requestId, secondResponse.requestId);

    const refreshedSession = await gameSessionService.findByGameId(context.room.roomId);
    assert.ok(refreshedSession);
    assert.equal(refreshedSession?.votes[voter!.userId], firstTarget!.userId);
    assert.notEqual(refreshedSession?.votes[voter!.userId], secondTarget!.userId);

    const eventCount = await prisma.gameEventLog.count({
      where: {
        gameId: context.room.roomId,
        type: 'VoteCasted',
        requestId: `${context.room.roomId}-vote`,
      },
    });

    assert.equal(eventCount, 1);

    const voteEvent = await prisma.gameEventLog.findFirst({
      where: {
        gameId: context.room.roomId,
        type: 'VoteCasted',
        requestId: `${context.room.roomId}-vote`,
      },
    });

    assert.ok(voteEvent);
    assert.deepEqual(voteEvent?.payload, {
      targetUserId: firstTarget!.userId,
    });

    const idempotency = await requestIdempotencyService.find({
      gameId: context.room.roomId,
      userId: voter!.userId,
      requestId: `${context.room.roomId}-vote`,
    });

    assert.ok(idempotency);
    assert.equal(idempotency?.status, 'COMPLETED');
    assert.equal(idempotency?.resultType, 'COMMAND_ACCEPTED');
  } finally {
    for (const socket of context.sockets) {
      socket.disconnect();
    }

    await cleanupGame(context.room.roomId);
    await cleanupIdempotency({
      gameId: context.room.roomId,
      userId: voter!.userId,
      requestId: `${context.room.roomId}-vote`,
    });
    await cleanupConnectionState([
      { socket: context.players.host.socket, userId: context.players.host.userId },
      { socket: context.players.guest1.socket, userId: context.players.guest1.userId },
      { socket: context.players.guest2.socket, userId: context.players.guest2.userId },
      { socket: context.players.guest3.socket, userId: context.players.guest3.userId },
    ]);
  }
});

test('duplicate completed rejected JOIN_ROOM replays the same rejection', async () => {
  const player = buildAuthedSocket(`dup-reject-${randomUUID()}`);
  await waitForConnect(player.socket);

  try {
    const firstResponse = await joinRoomCommand(
      player.socket,
      'missing-room-id',
      'alpha',
      `${player.userId}-missing-room`,
    );
    const secondResponse = await joinRoomCommand(
      player.socket,
      'missing-room-id',
      'alpha',
      `${player.userId}-missing-room`,
    );

    assert.equal(firstResponse.type, 'COMMAND_REJECTED');
    assert.equal(secondResponse.type, 'COMMAND_REJECTED');
    assert.equal(firstResponse.reason, 'ROOM_NOT_FOUND');
    assert.equal(secondResponse.reason, 'ROOM_NOT_FOUND');
    assert.equal(firstResponse.requestId, secondResponse.requestId);

    const idempotency = await requestIdempotencyService.find({
      gameId: 'missing-room-id',
      userId: player.userId,
      requestId: `${player.userId}-missing-room`,
    });

    assert.ok(idempotency);
    assert.equal(idempotency?.status, 'COMPLETED');
    assert.equal(idempotency?.resultType, 'COMMAND_REJECTED');
    assert.equal(idempotency?.reason, 'ROOM_NOT_FOUND');
  } finally {
    player.socket.disconnect();
    await cleanupIdempotency({
      gameId: 'missing-room-id',
      userId: player.userId,
      requestId: `${player.userId}-missing-room`,
    });
    await cleanupConnectionState([{ socket: player.socket, userId: player.userId }]);
  }
});

test('lock busy returns GAME_LOCK_BUSY and same requestId replays it', async () => {
  const roomsServiceLocal = app.get(RoomsService);
  const player = buildAuthedSocket(`lock-busy-${randomUUID()}`);
  await waitForConnect(player.socket);

  const room = roomsServiceLocal.createRoom({
    hostUserId: player.userId,
    name: `lock-busy-room-${randomUUID()}`,
  });

  try {
    await joinRoomCommand(player.socket, room.roomId, 'alpha', `${room.roomId}-join`);

    await redisService.getClient().set(
      redisService.buildKey(`lock:game:${room.roomId}`),
      'held-token',
      'PX',
      5000,
    );

    const firstResponse = await readyRoomCommand(
      player.socket,
      room.roomId,
      true,
      `${room.roomId}-ready-busy`,
    );
    const secondResponse = await readyRoomCommand(
      player.socket,
      room.roomId,
      true,
      `${room.roomId}-ready-busy`,
    );

    assert.equal(firstResponse.type, 'COMMAND_REJECTED');
    assert.equal(firstResponse.reason, 'GAME_LOCK_BUSY');
    assert.equal(secondResponse.type, 'COMMAND_REJECTED');
    assert.equal(secondResponse.reason, 'GAME_LOCK_BUSY');
    assert.equal(firstResponse.requestId, secondResponse.requestId);

    const eventCount = await prisma.gameEventLog.count({
      where: {
        gameId: room.roomId,
        requestId: `${room.roomId}-ready-busy`,
      },
    });
    assert.equal(eventCount, 0);

    const idempotency = await requestIdempotencyService.find({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-ready-busy`,
    });

    assert.ok(idempotency);
    assert.equal(idempotency?.status, 'COMPLETED');
    assert.equal(idempotency?.resultType, 'COMMAND_REJECTED');
    assert.equal(idempotency?.reason, 'GAME_LOCK_BUSY');
  } finally {
    await redisService.del(`lock:game:${room.roomId}`);
    player.socket.disconnect();
    await cleanupGame(room.roomId);
    await cleanupIdempotency({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-ready-busy`,
    });
    await cleanupConnectionState([{ socket: player.socket, userId: player.userId }]);
  }
});

test('lock busy 후 새 requestId로는 retry가 가능하다', async () => {
  const roomsServiceLocal = app.get(RoomsService);
  const player = buildAuthedSocket(`lock-retry-${randomUUID()}`);
  await waitForConnect(player.socket);

  const room = roomsServiceLocal.createRoom({
    hostUserId: player.userId,
    name: `lock-retry-room-${randomUUID()}`,
  });

  try {
    await joinRoomCommand(player.socket, room.roomId, 'alpha', `${room.roomId}-join`);

    await redisService.getClient().set(
      redisService.buildKey(`lock:game:${room.roomId}`),
      'held-token',
      'PX',
      5000,
    );

    const firstResponse = await readyRoomCommand(
      player.socket,
      room.roomId,
      true,
      `${room.roomId}-ready-1`,
    );
    assert.equal(firstResponse.type, 'COMMAND_REJECTED');
    assert.equal(firstResponse.reason, 'GAME_LOCK_BUSY');

    await redisService.del(`lock:game:${room.roomId}`);

    const secondResponse = await readyRoomCommand(
      player.socket,
      room.roomId,
      true,
      `${room.roomId}-ready-2`,
    );
    assert.equal(secondResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(secondResponse.receivedType, 'CHANGE_READY');

    const eventCount = await prisma.gameEventLog.count({
      where: {
        gameId: room.roomId,
        type: 'PlayerReadyChanged',
      },
    });
    assert.equal(eventCount, 1);

    const firstRequest = await requestIdempotencyService.find({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-ready-1`,
    });
    const secondRequest = await requestIdempotencyService.find({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-ready-2`,
    });

    assert.ok(firstRequest);
    assert.ok(secondRequest);
    assert.equal(firstRequest?.resultType, 'COMMAND_REJECTED');
    assert.equal(firstRequest?.reason, 'GAME_LOCK_BUSY');
    assert.equal(secondRequest?.resultType, 'COMMAND_ACCEPTED');
  } finally {
    await redisService.del(`lock:game:${room.roomId}`);
    player.socket.disconnect();
    await cleanupGame(room.roomId);
    await cleanupIdempotency({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-ready-1`,
    });
    await cleanupIdempotency({
      gameId: room.roomId,
      userId: player.userId,
      requestId: `${room.roomId}-ready-2`,
    });
    await cleanupConnectionState([{ socket: player.socket, userId: player.userId }]);
  }
});

test('disconnect/reconnect 자체는 GameEventLog를 추가하지 않는다', async () => {
  const context = await createStartedGameContext(`disconnect-${randomUUID()}`);
  let reconnectUserId = '';
  let reconnectingSocket: Socket | undefined;

  try {
    const reconnectUser = context.session?.players.find(
      (player) => player.userId !== context.players.host.userId && player.role !== 'MAFIA',
    );
    assert.ok(reconnectUser);
    reconnectUserId = reconnectUser!.userId;

    const reconnectSocket = context.socketsByUserId.get(reconnectUser!.userId);
    assert.ok(reconnectSocket);

    const countBeforeDisconnect = await prisma.gameEventLog.count({
      where: {
        gameId: context.room.roomId,
      },
    });

    reconnectSocket!.disconnect();
    await waitForConnectionState(
      reconnectUser!.userId,
      (state) =>
        state?.status === 'DISCONNECTED' &&
        state.roomId === context.room.roomId,
    );

    reconnectingSocket = connectClient({
      token: new JwtService().signAccessToken({
        id: reconnectUser!.userId,
        email: `${reconnectUser!.userId}@example.com`,
      }),
    }, false);

    try {
      const reconnectStatePromise = waitForEvent<ReconnectStateEvent>(
        reconnectingSocket,
        'reconnect:state',
        5000,
      );

      reconnectingSocket.connect();

      const reconnectState = await reconnectStatePromise;

      assert.equal(reconnectState.restored, true);

      const countAfterReconnect = await prisma.gameEventLog.count({
        where: {
          gameId: context.room.roomId,
        },
      });

      assert.equal(countAfterReconnect, countBeforeDisconnect);
    } finally {
      reconnectingSocket?.disconnect();
    }
  } finally {
    for (const socket of context.sockets) {
      socket.disconnect();
    }

    await cleanupGame(context.room.roomId);
    await cleanupConnectionState([
      { socket: context.players.host.socket, userId: context.players.host.userId },
      { socket: context.players.guest1.socket, userId: context.players.guest1.userId },
      { socket: context.players.guest2.socket, userId: context.players.guest2.userId },
      { socket: context.players.guest3.socket, userId: context.players.guest3.userId },
      ...(reconnectingSocket
        ? [{ socket: reconnectingSocket, userId: reconnectUserId }]
        : []),
    ]);
  }
});
