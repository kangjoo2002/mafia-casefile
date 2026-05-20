import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventVisibility } from '@prisma/client';
import { JwtService } from '../auth/jwt.service';
import { GameSessionService } from '../game-session/game-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
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
const gameIds = new Set<string>();

@Module({
  imports: [RealtimeModule],
})
class RealtimeTestModule {}

function getUrl() {
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test port');
  }

  return `http://127.0.0.1:${address.port}`;
}

function connectClient(auth: { token: string }) {
  const socket = io(getUrl(), {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: false,
    auth,
  });

  socket.auth = auth;
  (socket.io.opts as any).auth = auth;
  socket.connect();
  return socket;
}

async function waitForConnect(socket: Socket) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('connection timed out'));
    }, 2000);

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

async function sendCommandAndWait<T>(socket: Socket, command: unknown) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('command response timed out'));
    }, 2500);

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
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
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
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'CHANGE_READY',
    requestId,
    gameId: roomId,
    payload: {
      isReady,
    },
  });
}

function startGameCommand(socket: Socket, roomId: string, requestId: string) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'START_GAME',
    requestId,
    gameId: roomId,
    payload: {},
  });
}

function nextPhaseCommand(socket: Socket, roomId: string, requestId: string) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'NEXT_PHASE',
    requestId,
    gameId: roomId,
    payload: {},
  });
}

function nightActionCommand(
  socket: Socket,
  type: 'SELECT_MAFIA_TARGET' | 'SELECT_DOCTOR_TARGET' | 'SELECT_POLICE_TARGET',
  roomId: string,
  targetUserId: string,
  requestId: string,
) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type,
    requestId,
    gameId: roomId,
    payload: {
      targetUserId,
    },
  });
}

function voteCommand(
  socket: Socket,
  roomId: string,
  targetUserId: string,
  requestId: string,
) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
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
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'SEND_CHAT_MESSAGE',
    requestId,
    gameId: roomId,
    payload: {
      channel,
      message,
    },
  });
}

async function createStartedGameContext(prefix: string) {
  const roomsService = app.get(RoomsService);
  const gameSessionService = app.get(GameSessionService);

  const host = buildAuthedSocket(`${prefix}-host`);
  const guest1 = buildAuthedSocket(`${prefix}-guest-1`);
  const guest2 = buildAuthedSocket(`${prefix}-guest-2`);
  const guest3 = buildAuthedSocket(`${prefix}-guest-3`);

  await Promise.all([
    waitForConnect(host.socket),
    waitForConnect(guest1.socket),
    waitForConnect(guest2.socket),
    waitForConnect(guest3.socket),
  ]);

  const room = roomsService.createRoom({
    hostUserId: host.userId,
    name: `${prefix}-room`,
  });
  gameIds.add(room.roomId);
  const startRequestId = `${prefix}-start`;

  await joinRoomCommand(host.socket, room.roomId, 'host', `${prefix}-join-host`);
  await joinRoomCommand(guest1.socket, room.roomId, 'g1', `${prefix}-join-1`);
  await joinRoomCommand(guest2.socket, room.roomId, 'g2', `${prefix}-join-2`);
  await joinRoomCommand(guest3.socket, room.roomId, 'g3', `${prefix}-join-3`);

  await readyRoomCommand(host.socket, room.roomId, true, `${prefix}-ready-host`);
  await readyRoomCommand(guest1.socket, room.roomId, true, `${prefix}-ready-1`);
  await readyRoomCommand(guest2.socket, room.roomId, true, `${prefix}-ready-2`);
  await readyRoomCommand(guest3.socket, room.roomId, true, `${prefix}-ready-3`);

  const startResponse = await startGameCommand(host.socket, room.roomId, startRequestId);

  assert.equal(startResponse.type, 'COMMAND_ACCEPTED');

  const session = await gameSessionService.findByGameId(room.roomId);
  assert.ok(session);

  return {
    room,
    session,
    sockets: {
      host: host.socket,
      guest1: guest1.socket,
      guest2: guest2.socket,
      guest3: guest3.socket,
    },
    players: {
      host,
      guest1,
      guest2,
      guest3,
    },
    startRequestId,
  };
}

async function cleanupGame(gameId: string) {
  await prisma.gameEventLog
    .deleteMany({
      where: {
        gameId,
      },
    })
    .catch(() => undefined);
}

before(async () => {
  await prisma.$connect();
  app = await NestFactory.create(RealtimeTestModule, {
    logger: false,
  });
  await app.listen(0, '127.0.0.1');
});

after(async () => {
  await prisma.gameEventLog
    .deleteMany({
      where: {
        gameId: {
          in: [...gameIds],
        },
      },
    })
    .catch(() => undefined);

  await prisma.$disconnect();
  await app.close();
});

test('room lifecycle events are recorded with contiguous seqs', async () => {
  const roomsService = app.get(RoomsService);
  const host = buildAuthedSocket(`lifecycle-host-${randomUUID()}`);
  const guest = buildAuthedSocket(`lifecycle-guest-${randomUUID()}`);

  await Promise.all([waitForConnect(host.socket), waitForConnect(guest.socket)]);

  const room = roomsService.createRoom({
    hostUserId: host.userId,
    name: `lifecycle-room-${randomUUID()}`,
  });
  gameIds.add(room.roomId);

  try {
    const hostJoin = await joinRoomCommand(
      host.socket,
      room.roomId,
      'host',
      'req-life-join-host',
    );
    const guestJoin = await joinRoomCommand(
      guest.socket,
      room.roomId,
      'guest',
      'req-life-join-guest',
    );
    const hostReady = await readyRoomCommand(
      host.socket,
      room.roomId,
      true,
      'req-life-ready-host',
    );
    const guestReady = await readyRoomCommand(
      guest.socket,
      room.roomId,
      true,
      'req-life-ready-guest',
    );
    const guestLeave = await sendCommandAndWait<{
      type: string;
      requestId: string;
      receivedType?: string;
      reason?: string;
      message?: string;
    }>(guest.socket, {
      type: 'LEAVE_ROOM',
      requestId: 'req-life-leave-guest',
      gameId: room.roomId,
      payload: {},
    });

    assert.equal(hostJoin.type, 'COMMAND_ACCEPTED');
    assert.equal(guestJoin.type, 'COMMAND_ACCEPTED');
    assert.equal(hostReady.type, 'COMMAND_ACCEPTED');
    assert.equal(guestReady.type, 'COMMAND_ACCEPTED');
    assert.equal(guestLeave.type, 'COMMAND_ACCEPTED');

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    assert.deepEqual(
      events.map((event) => event.seq),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      events.map((event) => event.type),
      [
        'PlayerJoined',
        'PlayerJoined',
        'PlayerReadyChanged',
        'PlayerReadyChanged',
        'PlayerLeft',
      ],
    );
    assert.deepEqual(
      events.map((event) => event.requestId),
      [
        'req-life-join-host',
        'req-life-join-guest',
        'req-life-ready-host',
        'req-life-ready-guest',
        'req-life-leave-guest',
      ],
    );
    assert.deepEqual(
      events.map((event) => event.actorUserId),
      [host.userId, guest.userId, host.userId, guest.userId, guest.userId],
    );
    assert.ok(events.every((event) => event.turn === 0));
    assert.ok(events.every((event) => event.phase === 'WAITING'));
    assert.ok(
      events.every(
        (event) =>
          event.visibilityDuringGame === EventVisibility.PUBLIC &&
          event.visibilityAfterGame === EventVisibility.PUBLIC,
      ),
    );
    assert.deepEqual(events[0]?.payload, {
      roomId: room.roomId,
      userId: host.userId,
      nickname: 'host',
    });
    assert.deepEqual(events[2]?.payload, {
      userId: host.userId,
      isReady: true,
    });
    assert.deepEqual(events[4]?.payload, {
      roomId: room.roomId,
      userId: guest.userId,
      reason: 'LEFT_ROOM',
    });
  } finally {
    host.socket.disconnect();
    guest.socket.disconnect();
    await cleanupGame(room.roomId);
  }
});

test('start game and role assignment events are recorded', async () => {
  const context = await createStartedGameContext(`start-${randomUUID()}`);

  try {
    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    assert.deepEqual(
      events.map((event) => event.seq),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    );

    const gameStarted = events.find((event) => event.type === 'GameStarted');
    const roleAssigned = events.filter((event) => event.type === 'RoleAssigned');

    assert.ok(gameStarted);
    assert.equal(gameStarted?.requestId, context.startRequestId);
    assert.equal(gameStarted?.turn, 0);
    assert.equal(gameStarted?.phase, 'WAITING');
    assert.equal(gameStarted?.visibilityDuringGame, EventVisibility.PUBLIC);
    assert.equal(gameStarted?.visibilityAfterGame, EventVisibility.PUBLIC);
    const startedAt = (gameStarted?.payload as { startedAt?: string } | undefined)?.startedAt;
    assert.equal(typeof startedAt, 'string');
    assert.ok(startedAt);
    assert.deepEqual(gameStarted?.payload, {
      gameId: context.room.roomId,
      roomId: context.room.roomId,
      startedByUserId: context.players.host.userId,
      startedAt,
    });

    assert.equal(roleAssigned.length, 4);
    assert.deepEqual(
      roleAssigned.map((event) => event.requestId),
      [
        context.startRequestId,
        context.startRequestId,
        context.startRequestId,
        context.startRequestId,
      ],
    );
    assert.ok(roleAssigned.every((event) => event.turn === 0));
    assert.ok(roleAssigned.every((event) => event.phase === 'WAITING'));
    assert.ok(
      roleAssigned.every(
        (event) =>
          event.visibilityDuringGame === EventVisibility.PRIVATE &&
          event.visibilityAfterGame === EventVisibility.PUBLIC,
      ),
    );
    assert.equal(new Set(roleAssigned.map((event) => event.actorUserId)).size, 1);
    assert.equal(roleAssigned[0]?.actorUserId, null);
    assert.deepEqual(
      roleAssigned.map((event) => (event.payload as { userId: string }).userId).sort(),
      [
        context.players.guest1.userId,
        context.players.guest2.userId,
        context.players.guest3.userId,
        context.players.host.userId,
      ].sort(),
    );
    assert.deepEqual(
      roleAssigned
        .map((event) => (event.payload as { role: string }).role)
        .sort(),
      ['CITIZEN', 'DOCTOR', 'MAFIA', 'POLICE'],
    );
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('night action event visibility is recorded correctly', async () => {
  const context = await createStartedGameContext(`night-${randomUUID()}`);
  const session = context.session;
  const socketsByUserId = new Map<string, Socket>([
    [context.players.host.userId, context.players.host.socket],
    [context.players.guest1.userId, context.players.guest1.socket],
    [context.players.guest2.userId, context.players.guest2.socket],
    [context.players.guest3.userId, context.players.guest3.socket],
  ]);

  const mafiaPlayer = session.players.find((player) => player.role === 'MAFIA');
  const doctorPlayer = session.players.find((player) => player.role === 'DOCTOR');
  const policePlayer = session.players.find((player) => player.role === 'POLICE');
  const citizenPlayer = session.players.find((player) => player.role === 'CITIZEN');

  assert.ok(mafiaPlayer);
  assert.ok(doctorPlayer);
  assert.ok(policePlayer);
  assert.ok(citizenPlayer);

  const mafiaSocket = socketsByUserId.get(mafiaPlayer.userId);
  const doctorSocket = socketsByUserId.get(doctorPlayer.userId);
  const policeSocket = socketsByUserId.get(policePlayer.userId);

  assert.ok(mafiaSocket);
  assert.ok(doctorSocket);
  assert.ok(policeSocket);

  try {
    await nightActionCommand(
      mafiaSocket!,
      'SELECT_MAFIA_TARGET',
      context.room.roomId,
      citizenPlayer.userId,
      'req-night-mafia',
    );
    await nightActionCommand(
      doctorSocket!,
      'SELECT_DOCTOR_TARGET',
      context.room.roomId,
      mafiaPlayer.userId,
      'req-night-doctor',
    );
    await nightActionCommand(
      policeSocket!,
      'SELECT_POLICE_TARGET',
      context.room.roomId,
      mafiaPlayer.userId,
      'req-night-police',
    );

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const nightEvents = events.filter((event) =>
      ['MafiaTargetSelected', 'DoctorTargetSelected', 'PoliceInvestigated'].includes(
        event.type,
      ),
    );

    assert.deepEqual(
      events.map((event) => event.seq),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    );
    assert.deepEqual(
      nightEvents.map((event) => event.type),
      ['MafiaTargetSelected', 'DoctorTargetSelected', 'PoliceInvestigated'],
    );
    assert.deepEqual(
      nightEvents.map((event) => event.requestId),
      ['req-night-mafia', 'req-night-doctor', 'req-night-police'],
    );
    assert.ok(nightEvents.every((event) => event.turn === 0));
    assert.ok(nightEvents.every((event) => event.phase === 'NIGHT'));
    assert.equal(
      nightEvents[0]?.visibilityDuringGame,
      EventVisibility.MAFIA_ONLY,
    );
    assert.equal(nightEvents[1]?.visibilityDuringGame, EventVisibility.PRIVATE);
    assert.equal(nightEvents[2]?.visibilityDuringGame, EventVisibility.PRIVATE);
    assert.equal(nightEvents[0]?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.equal(nightEvents[1]?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.equal(nightEvents[2]?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.equal(nightEvents[0]?.actorUserId, mafiaPlayer.userId);
    assert.equal(nightEvents[1]?.actorUserId, doctorPlayer.userId);
    assert.equal(nightEvents[2]?.actorUserId, policePlayer.userId);
    assert.deepEqual(nightEvents[0]?.payload, {
      targetUserId: citizenPlayer.userId,
    });
    assert.deepEqual(nightEvents[1]?.payload, {
      targetUserId: mafiaPlayer.userId,
    });
    assert.deepEqual(nightEvents[2]?.payload, {
      targetUserId: mafiaPlayer.userId,
      result: 'MAFIA',
    });
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('lobby chat event visibility is recorded correctly', async () => {
  const roomsService = app.get(RoomsService);
  const host = buildAuthedSocket(`lobby-host-${randomUUID()}`);
  const guest = buildAuthedSocket(`lobby-guest-${randomUUID()}`);

  await Promise.all([waitForConnect(host.socket), waitForConnect(guest.socket)]);

  const room = roomsService.createRoom({
    hostUserId: host.userId,
    name: `lobby-room-${randomUUID()}`,
  });
  gameIds.add(room.roomId);

  try {
    await joinRoomCommand(host.socket, room.roomId, 'host', 'req-lobby-join');
    await joinRoomCommand(guest.socket, room.roomId, 'guest', 'req-lobby-join-2');

    await chatCommand(
      host.socket,
      room.roomId,
      'LOBBY',
      '  hello lobby  ',
      'req-lobby-chat',
    );

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const chatEvent = events.find((event) => event.type === 'ChatMessageSent');

    assert.ok(chatEvent);
    assert.equal(chatEvent?.phase, 'WAITING');
    assert.equal(chatEvent?.turn, 0);
    assert.equal(chatEvent?.visibilityDuringGame, EventVisibility.PUBLIC);
    assert.equal(chatEvent?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.deepEqual(chatEvent?.payload, {
      channel: 'LOBBY',
      message: 'hello lobby',
      senderUserId: host.userId,
    });
  } finally {
    host.socket.disconnect();
    guest.socket.disconnect();
    await cleanupGame(room.roomId);
  }
});

test('day chat event visibility is recorded correctly', async () => {
  const context = await createStartedGameContext(`day-${randomUUID()}`);

  try {
    const response = await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      'req-day-next',
    );

    assert.equal(response.type, 'COMMAND_ACCEPTED');
    assert.equal(response.receivedType, 'NEXT_PHASE');

    const dayChatResponse = await chatCommand(
      context.players.guest1.socket,
      context.room.roomId,
      'DAY',
      '  good day  ',
      'req-day-chat',
    );

    assert.equal(dayChatResponse.type, 'COMMAND_ACCEPTED');

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const chatEvent = events.find((event) => event.type === 'ChatMessageSent');

    assert.ok(chatEvent);
    assert.equal(chatEvent?.phase, 'DAY_DISCUSSION');
    assert.equal(chatEvent?.turn, 1);
    assert.equal(chatEvent?.visibilityDuringGame, EventVisibility.PUBLIC);
    assert.equal(chatEvent?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.deepEqual(chatEvent?.payload, {
      channel: 'DAY',
      message: 'good day',
      senderUserId: context.players.guest1.userId,
    });
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('mafia chat event visibility is recorded correctly', async () => {
  const context = await createStartedGameContext(`mafia-${randomUUID()}`);

  try {
    const mafiaPlayer = context.session.players.find(
      (player) => player.role === 'MAFIA',
    );
    assert.ok(mafiaPlayer);

    const mafiaSocket =
      context.players.host.userId === mafiaPlayer!.userId
        ? context.players.host.socket
        : context.players.guest1.userId === mafiaPlayer!.userId
          ? context.players.guest1.socket
          : context.players.guest2.userId === mafiaPlayer!.userId
            ? context.players.guest2.socket
            : context.players.guest3.socket;

    const response = await chatCommand(
      mafiaSocket,
      context.room.roomId,
      'MAFIA',
      '  meet at 11  ',
      'req-mafia-chat',
    );

    assert.equal(response.type, 'COMMAND_ACCEPTED');

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const chatEvent = events.find((event) => event.type === 'ChatMessageSent');

    assert.ok(chatEvent);
    assert.equal(chatEvent?.phase, 'NIGHT');
    assert.equal(chatEvent?.turn, 0);
    assert.equal(chatEvent?.visibilityDuringGame, EventVisibility.MAFIA_ONLY);
    assert.equal(chatEvent?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.deepEqual(chatEvent?.payload, {
      channel: 'MAFIA',
      message: 'meet at 11',
      senderUserId: mafiaPlayer!.userId,
    });
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('ghost chat event visibility is recorded correctly', async () => {
  const context = await createStartedGameContext(`ghost-${randomUUID()}`);
  const gameSessionService = app.get(GameSessionService);

  try {
    const mafiaPlayer = context.session.players.find(
      (player) => player.role === 'MAFIA',
    );
    const doctorPlayer = context.session.players.find(
      (player) => player.role === 'DOCTOR',
    );
    const policePlayer = context.session.players.find(
      (player) => player.role === 'POLICE',
    );
    const citizenPlayer = context.session.players.find(
      (player) => player.role === 'CITIZEN',
    );

    assert.ok(mafiaPlayer);
    assert.ok(doctorPlayer);
    assert.ok(policePlayer);
    assert.ok(citizenPlayer);

    const socketsByUserId = new Map<string, Socket>([
      [context.players.host.userId, context.players.host.socket],
      [context.players.guest1.userId, context.players.guest1.socket],
      [context.players.guest2.userId, context.players.guest2.socket],
      [context.players.guest3.userId, context.players.guest3.socket],
    ]);

    const mafiaSocket = socketsByUserId.get(mafiaPlayer.userId);
    const doctorSocket = socketsByUserId.get(doctorPlayer.userId);
    const policeSocket = socketsByUserId.get(policePlayer.userId);

    assert.ok(mafiaSocket);
    assert.ok(doctorSocket);
    assert.ok(policeSocket);

    await nightActionCommand(
      mafiaSocket!,
      'SELECT_MAFIA_TARGET',
      context.room.roomId,
      citizenPlayer.userId,
      'req-ghost-night-mafia',
    );
    await nightActionCommand(
      doctorSocket!,
      'SELECT_DOCTOR_TARGET',
      context.room.roomId,
      mafiaPlayer.userId,
      'req-ghost-night-doctor',
    );
    await nightActionCommand(
      policeSocket!,
      'SELECT_POLICE_TARGET',
      context.room.roomId,
      mafiaPlayer.userId,
      'req-ghost-night-police',
    );
    await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      'req-ghost-next-day',
    );

    const resolvedSession = await gameSessionService.findByGameId(
      context.room.roomId,
    );
    assert.ok(resolvedSession);

    const deadCitizen = resolvedSession?.players.find(
      (player) => player.userId === citizenPlayer.userId,
    );
    assert.equal(deadCitizen?.status, 'DEAD');

    const deadCitizenSocket = socketsByUserId.get(citizenPlayer.userId);
    assert.ok(deadCitizenSocket);

    const response = await chatCommand(
      deadCitizenSocket!,
      context.room.roomId,
      'GHOST',
      '  i am dead  ',
      'req-ghost-chat',
    );

    assert.equal(response.type, 'COMMAND_ACCEPTED');

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const chatEvent = events.find((event) => event.type === 'ChatMessageSent');

    assert.ok(chatEvent);
    assert.equal(chatEvent?.visibilityDuringGame, EventVisibility.GHOST_ONLY);
    assert.equal(chatEvent?.visibilityAfterGame, EventVisibility.PUBLIC);
    assert.deepEqual(chatEvent?.payload, {
      channel: 'GHOST',
      message: 'i am dead',
      senderUserId: citizenPlayer.userId,
    });
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('phase resolution events are ordered and recorded', async () => {
  const context = await createStartedGameContext(`phase-${randomUUID()}`);
  const session = context.session;
  const socketsByUserId = new Map<string, Socket>([
    [context.players.host.userId, context.players.host.socket],
    [context.players.guest1.userId, context.players.guest1.socket],
    [context.players.guest2.userId, context.players.guest2.socket],
    [context.players.guest3.userId, context.players.guest3.socket],
  ]);

  const mafiaPlayer = session.players.find((player) => player.role === 'MAFIA');
  const doctorPlayer = session.players.find((player) => player.role === 'DOCTOR');
  const citizenPlayer = session.players.find((player) => player.role === 'CITIZEN');

  assert.ok(mafiaPlayer);
  assert.ok(doctorPlayer);
  assert.ok(citizenPlayer);

  const mafiaSocket = socketsByUserId.get(mafiaPlayer.userId);
  const doctorSocket = socketsByUserId.get(doctorPlayer.userId);

  assert.ok(mafiaSocket);
  assert.ok(doctorSocket);

  try {
    await nightActionCommand(
      mafiaSocket!,
      'SELECT_MAFIA_TARGET',
      context.room.roomId,
      citizenPlayer.userId,
      'req-phase-night-mafia',
    );
    await nightActionCommand(
      doctorSocket!,
      'SELECT_DOCTOR_TARGET',
      context.room.roomId,
      mafiaPlayer.userId,
      'req-phase-night-doctor',
    );

    const nightResolution = await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      'req-phase-next-day',
    );

    assert.equal(nightResolution.type, 'COMMAND_ACCEPTED');

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const phaseChanged = events.find((event) => event.type === 'PhaseChanged');
    const playerKilled = events.find((event) => event.type === 'PlayerKilled');
    const gameFinished = events.find((event) => event.type === 'GameFinished');

    assert.ok(phaseChanged);
    assert.ok(playerKilled);
    assert.equal(gameFinished, undefined);
    assert.equal(phaseChanged?.requestId, 'req-phase-next-day');
    assert.equal(playerKilled?.requestId, 'req-phase-next-day');
    assert.ok((phaseChanged?.seq ?? 0) < (playerKilled?.seq ?? 0));
    assert.deepEqual(playerKilled?.payload, {
      targetUserId: citizenPlayer.userId,
      cause: 'MAFIA_ATTACK',
      protectedByDoctor: false,
    });
    assert.equal(playerKilled?.visibilityDuringGame, EventVisibility.PUBLIC);
    assert.equal(playerKilled?.visibilityAfterGame, EventVisibility.PUBLIC);
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('voting resolution events are ordered and recorded', async () => {
  const context = await createStartedGameContext(`vote-${randomUUID()}`);
  const session = context.session;
  const socketsByUserId = new Map<string, Socket>([
    [context.players.host.userId, context.players.host.socket],
    [context.players.guest1.userId, context.players.guest1.socket],
    [context.players.guest2.userId, context.players.guest2.socket],
    [context.players.guest3.userId, context.players.guest3.socket],
  ]);

  const citizenPlayer = session.players.find((player) => player.role === 'CITIZEN');
  assert.ok(citizenPlayer);

  try {
    await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      'req-vote-next-day',
    );
    const toVoting = await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      'req-vote-next-voting',
    );

    assert.equal(toVoting.type, 'COMMAND_ACCEPTED');

    const voteRequests = [
      { userId: context.players.host.userId, requestId: 'req-vote-1' },
      { userId: context.players.guest1.userId, requestId: 'req-vote-2' },
      { userId: context.players.guest2.userId, requestId: 'req-vote-3' },
      { userId: context.players.guest3.userId, requestId: 'req-vote-4' },
    ] as const;

    for (const voteRequest of voteRequests) {
      const socket = socketsByUserId.get(voteRequest.userId);
      assert.ok(socket);

      const voteResponse = await voteCommand(
        socket!,
        context.room.roomId,
        citizenPlayer.userId,
        voteRequest.requestId,
      );

      assert.equal(voteResponse.type, 'COMMAND_ACCEPTED');
    }

    const resolution = await nextPhaseCommand(
      context.players.host.socket,
      context.room.roomId,
      'req-vote-next-result',
    );

    assert.equal(resolution.type, 'COMMAND_ACCEPTED');

    const events = await prisma.gameEventLog.findMany({
      where: {
        gameId: context.room.roomId,
      },
      orderBy: {
        seq: 'asc',
      },
    });

    const voteEvents = events.filter((event) => event.type === 'VoteCasted');
    const phaseChanged = events.find(
      (event) => event.type === 'PhaseChanged' && event.requestId === 'req-vote-next-result',
    );
    const playerExecuted = events.find(
      (event) => event.type === 'PlayerExecuted',
    );
    const gameFinished = events.find((event) => event.type === 'GameFinished');

    assert.equal(voteEvents.length, 4);
    assert.ok(
      voteEvents.every(
        (event) =>
          event.visibilityDuringGame === EventVisibility.PUBLIC &&
          event.visibilityAfterGame === EventVisibility.PUBLIC,
      ),
    );
    assert.deepEqual(
      voteEvents.map((event) => event.actorUserId).sort(),
      [
        context.players.guest1.userId,
        context.players.guest2.userId,
        context.players.guest3.userId,
        context.players.host.userId,
      ].sort(),
    );
    assert.ok(phaseChanged);
    assert.ok(playerExecuted);
    assert.equal(gameFinished, undefined);
    assert.ok((phaseChanged?.seq ?? 0) < (playerExecuted?.seq ?? 0));
    assert.equal(phaseChanged?.requestId, 'req-vote-next-result');
    assert.equal(playerExecuted?.requestId, 'req-vote-next-result');
    assert.deepEqual(playerExecuted?.payload, {
      targetUserId: citizenPlayer.userId,
      voteResult: [
        {
          targetUserId: citizenPlayer.userId,
          count: 4,
        },
      ],
    });
    assert.equal(playerExecuted?.visibilityDuringGame, EventVisibility.PUBLIC);
    assert.equal(playerExecuted?.visibilityAfterGame, EventVisibility.PUBLIC);
  } finally {
    context.players.host.socket.disconnect();
    context.players.guest1.socket.disconnect();
    context.players.guest2.socket.disconnect();
    context.players.guest3.socket.disconnect();
    await cleanupGame(context.room.roomId);
  }
});

test('duplicate join request does not create duplicate GameEventLog', async () => {
  const roomsService = app.get(RoomsService);
  const host = buildAuthedSocket(`dup-host-${randomUUID()}`);

  await waitForConnect(host.socket);

  const room = roomsService.createRoom({
    hostUserId: host.userId,
    name: `dup-room-${randomUUID()}`,
  });
  gameIds.add(room.roomId);

  try {
    const first = await joinRoomCommand(
      host.socket,
      room.roomId,
      'alpha',
      'req-dup-join',
    );
    const second = await joinRoomCommand(
      host.socket,
      room.roomId,
      'alpha',
      'req-dup-join',
    );

    assert.equal(first.type, 'COMMAND_ACCEPTED');
    assert.equal(second.type, 'COMMAND_ACCEPTED');

    const eventCount = await prisma.gameEventLog.count({
      where: {
        gameId: room.roomId,
        type: 'PlayerJoined',
        requestId: 'req-dup-join',
      },
    });

    assert.equal(eventCount, 1);
  } finally {
    host.socket.disconnect();
    await cleanupGame(room.roomId);
  }
});
