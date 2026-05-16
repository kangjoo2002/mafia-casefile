import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { GameStartedEvent, RoleAssignedEvent } from '@mafia-casefile/shared';
import { JwtService } from '../auth/jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { RealtimeModule } from './realtime.module';
import { io, Socket } from 'socket.io-client';

process.env.JWT_SECRET = 'test-secret';

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let client: Socket | undefined;
const prisma = new PrismaService();

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

function connectClient(auth?: { token?: unknown }) {
  const socket = io(getUrl(), {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: false,
    auth: auth ?? {},
  });

  socket.auth = auth ?? {};
  (socket.io.opts as any).auth = auth ?? {};
  socket.connect();
  return socket;
}

async function waitForConnectError(socket: Socket) {
  return await new Promise<Error>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('expected connect_error'));
    }, 2000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error('expected connection to fail'));
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      resolve(error);
    });
  });
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
    }, 2000);

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

async function waitForEvent<T>(socket: Socket, eventName: string) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`${eventName} timed out`));
    }, 2000);

    const handler = (message: T) => {
      clearTimeout(timeout);
      resolve(message);
    };

    socket.once(eventName, handler);
  });
}

function buildAuthedSocket(userId: string, email: string) {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: userId,
    email,
  });

  const socket = connectClient({ token });
  return { socket, jwtService, token };
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

before(async () => {
  await prisma.$connect();
  app = await NestFactory.create(RealtimeTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');
});

after(async () => {
  client?.disconnect();
  await prisma.$disconnect();
  await app.close();
});

test('connection fails without token', async () => {
  const socket = connectClient();
  const error = await waitForConnectError(socket);

  assert.ok(error instanceof Error);
});

test('connection fails with invalid token', async () => {
  const socket = connectClient({ token: 'invalid-token' });
  const error = await waitForConnectError(socket);

  assert.ok(error instanceof Error);
});

test('authenticated connection handles ping and whoami', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-123',
    email: 'user@example.com',
  });
  assert.doesNotThrow(() => jwtService.verifyAccessToken(token));

  client = connectClient({ token });
  await waitForConnect(client);

  const pong = await new Promise<{ type: string; timestamp: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pong timed out')), 2000);
    client?.once('pong', (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    client?.emit('ping');
  });

  assert.equal(pong.type, 'pong');
  assert.equal(typeof pong.timestamp, 'string');
  assert.ok(pong.timestamp.length > 0);

  const user = await new Promise<{ id: string; email: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('whoami timed out')), 2000);
    client?.once('whoami', (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    client?.emit('whoami');
  });

  assert.deepEqual(user, {
    id: 'user-id-123',
    email: 'user@example.com',
  });
});

test('command envelope accepts valid commands', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-456',
    email: 'command-user@example.com',
  });

  const socket = connectClient({ token });
  await waitForConnect(socket);

  const response = await sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType: string;
  }>(socket, {
    type: 'PING_COMMAND',
    requestId: 'req-1',
    gameId: 'game-1',
    payload: {},
  });

  assert.equal(response.type, 'COMMAND_ACCEPTED');
  assert.equal(response.requestId, 'req-1');
  assert.equal(response.receivedType, 'PING_COMMAND');

  socket.disconnect();
});

test('command envelope rejects missing requestId', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-789',
    email: 'command-user-2@example.com',
  });

  const socket = connectClient({ token });
  await waitForConnect(socket);

  const response = await sendCommandAndWait<{
    type: string;
    requestId?: string;
    reason: string;
    message: string;
  }>(socket, {
    type: 'PING_COMMAND',
    gameId: 'game-1',
    payload: {},
  });

  assert.equal(response.type, 'COMMAND_REJECTED');
  assert.equal(response.requestId, undefined);
  assert.equal(response.reason, 'INVALID_COMMAND_ENVELOPE');
  assert.equal(response.message, 'Command envelope is invalid.');

  socket.disconnect();
});

test('command envelope rejects empty requestId', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-987',
    email: 'command-user-3@example.com',
  });

  const socket = connectClient({ token });
  await waitForConnect(socket);

  const response = await sendCommandAndWait<{
    type: string;
    requestId?: string;
    reason: string;
    message: string;
  }>(socket, {
    type: 'PING_COMMAND',
    requestId: '',
    gameId: 'game-1',
    payload: {},
  });

  assert.equal(response.type, 'COMMAND_REJECTED');
  assert.equal(response.requestId, '');
  assert.equal(response.reason, 'INVALID_COMMAND_ENVELOPE');
  assert.equal(response.message, 'Command envelope is invalid.');

  socket.disconnect();
});

test('command envelope rejects missing type', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-654',
    email: 'command-user-4@example.com',
  });

  const socket = connectClient({ token });
  await waitForConnect(socket);

  const response = await sendCommandAndWait<{
    type: string;
    requestId: string;
    reason: string;
    message: string;
  }>(socket, {
    requestId: 'req-2',
    gameId: 'game-1',
    payload: {},
  });

  assert.equal(response.type, 'COMMAND_REJECTED');
  assert.equal(response.requestId, 'req-2');
  assert.equal(response.reason, 'INVALID_COMMAND_ENVELOPE');
  assert.equal(response.message, 'Command envelope is invalid.');

  socket.disconnect();
});

test('command envelope rejects missing gameId', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-321',
    email: 'command-user-5@example.com',
  });

  const socket = connectClient({ token });
  await waitForConnect(socket);

  const response = await sendCommandAndWait<{
    type: string;
    requestId: string;
    reason: string;
    message: string;
  }>(socket, {
    type: 'PING_COMMAND',
    requestId: 'req-3',
    payload: {},
  });

  assert.equal(response.type, 'COMMAND_REJECTED');
  assert.equal(response.requestId, 'req-3');
  assert.equal(response.reason, 'INVALID_COMMAND_ENVELOPE');
  assert.equal(response.message, 'Command envelope is invalid.');

  socket.disconnect();
});

test('command envelope rejects missing payload', async () => {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({
    id: 'user-id-111',
    email: 'command-user-6@example.com',
  });

  const socket = connectClient({ token });
  await waitForConnect(socket);

  const response = await sendCommandAndWait<{
    type: string;
    requestId: string;
    reason: string;
    message: string;
  }>(socket, {
    type: 'PING_COMMAND',
    requestId: 'req-4',
    gameId: 'game-1',
  });

  assert.equal(response.type, 'COMMAND_REJECTED');
  assert.equal(response.requestId, 'req-4');
  assert.equal(response.reason, 'INVALID_COMMAND_ENVELOPE');
  assert.equal(response.message, 'Command envelope is invalid.');

  socket.disconnect();
});

test('room join and leave broadcast participant updates and record events', async () => {
  const jwtService = new JwtService();
  const roomsService = app.get(RoomsService);

  const hostToken = jwtService.signAccessToken({
    id: 'room-host-user',
    email: 'room-host@example.com',
  });
  const guestToken = jwtService.signAccessToken({
    id: 'room-guest-user',
    email: 'room-guest@example.com',
  });

  const room = roomsService.createRoom({
    hostUserId: 'room-host-user',
    name: 'room-join-leave',
  });

  const hostSocket = connectClient({ token: hostToken });
  const guestSocket = connectClient({ token: guestToken });

  await waitForConnect(hostSocket);
  await waitForConnect(guestSocket);

  const hostRoomUpdated = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(hostSocket, 'room:updated');

  const hostJoinResponse = sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(hostSocket, {
    type: 'JOIN_ROOM',
    requestId: 'req-room-join-1',
    gameId: room.roomId,
    payload: {
      nickname: 'alpha',
    },
  });

  const [hostJoinResponseMessage, hostRoomUpdatedMessage] = await Promise.all([
    hostJoinResponse,
    hostRoomUpdated,
  ]);

  assert.equal(hostJoinResponseMessage.type, 'COMMAND_ACCEPTED');
  assert.equal(hostJoinResponseMessage.requestId, 'req-room-join-1');
  assert.equal(hostJoinResponseMessage.receivedType, 'JOIN_ROOM');
  assert.equal(hostRoomUpdatedMessage.room.roomId, room.roomId);
  assert.equal(hostRoomUpdatedMessage.room.playerCount, 1);
  assert.deepEqual(
    hostRoomUpdatedMessage.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [{ nickname: 'alpha', isReady: false }],
  );

  const hostSeesGuestJoin = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(hostSocket, 'room:updated');
  const guestSeesGuestJoin = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(guestSocket, 'room:updated');

  const guestJoinResponse = sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(guestSocket, {
    type: 'JOIN_ROOM',
    requestId: 'req-room-join-2',
    gameId: room.roomId,
    payload: {
      nickname: 'bravo',
    },
  });

  const [guestJoinResponseMessage, hostGuestJoinUpdate, guestGuestJoinUpdate] =
    await Promise.all([
      guestJoinResponse,
      hostSeesGuestJoin,
      guestSeesGuestJoin,
    ]);

  assert.equal(guestJoinResponseMessage.type, 'COMMAND_ACCEPTED');
  assert.equal(guestJoinResponseMessage.requestId, 'req-room-join-2');
  assert.equal(guestJoinResponseMessage.receivedType, 'JOIN_ROOM');
  assert.equal(hostGuestJoinUpdate.room.playerCount, 2);
  assert.equal(guestGuestJoinUpdate.room.playerCount, 2);
  assert.deepEqual(
    guestGuestJoinUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [
      { nickname: 'alpha', isReady: false },
      { nickname: 'bravo', isReady: false },
    ],
  );

  const hostSeesReadyTrue = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(hostSocket, 'room:updated');
  const guestSeesReadyTrue = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(guestSocket, 'room:updated');

  const readyTrueResponse = sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(hostSocket, {
    type: 'CHANGE_READY',
    requestId: 'req-room-ready-1',
    gameId: room.roomId,
    payload: {
      isReady: true,
    },
  });

  const [readyTrueResponseMessage, hostReadyTrueUpdate, guestReadyTrueUpdate] =
    await Promise.all([
      readyTrueResponse,
      hostSeesReadyTrue,
      guestSeesReadyTrue,
    ]);

  assert.equal(readyTrueResponseMessage.type, 'COMMAND_ACCEPTED');
  assert.equal(readyTrueResponseMessage.requestId, 'req-room-ready-1');
  assert.equal(readyTrueResponseMessage.receivedType, 'CHANGE_READY');
  assert.equal(hostReadyTrueUpdate.room.playerCount, 2);
  assert.deepEqual(
    hostReadyTrueUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [
      { nickname: 'alpha', isReady: true },
      { nickname: 'bravo', isReady: false },
    ],
  );
  assert.deepEqual(
    guestReadyTrueUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [
      { nickname: 'alpha', isReady: true },
      { nickname: 'bravo', isReady: false },
    ],
  );

  const hostSeesReadyFalse = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(hostSocket, 'room:updated');
  const guestSeesReadyFalse = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(guestSocket, 'room:updated');

  const readyFalseResponse = sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(hostSocket, {
    type: 'CHANGE_READY',
    requestId: 'req-room-ready-2',
    gameId: room.roomId,
    payload: {
      isReady: false,
    },
  });

  const [
    readyFalseResponseMessage,
    hostReadyFalseUpdate,
    guestReadyFalseUpdate,
  ] = await Promise.all([
    readyFalseResponse,
    hostSeesReadyFalse,
    guestSeesReadyFalse,
  ]);

  assert.equal(readyFalseResponseMessage.type, 'COMMAND_ACCEPTED');
  assert.equal(readyFalseResponseMessage.requestId, 'req-room-ready-2');
  assert.equal(readyFalseResponseMessage.receivedType, 'CHANGE_READY');
  assert.deepEqual(
    hostReadyFalseUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [
      { nickname: 'alpha', isReady: false },
      { nickname: 'bravo', isReady: false },
    ],
  );
  assert.deepEqual(
    guestReadyFalseUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [
      { nickname: 'alpha', isReady: false },
      { nickname: 'bravo', isReady: false },
    ],
  );

  const hostSeesGuestLeave = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(hostSocket, 'room:updated');

  const leaveResponse = sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(guestSocket, {
    type: 'LEAVE_ROOM',
    requestId: 'req-room-leave-1',
    gameId: room.roomId,
    payload: {},
  });

  const [leaveResponseMessage, hostGuestLeaveUpdate] = await Promise.all([
    leaveResponse,
    hostSeesGuestLeave,
  ]);

  assert.equal(leaveResponseMessage.type, 'COMMAND_ACCEPTED');
  assert.equal(leaveResponseMessage.requestId, 'req-room-leave-1');
  assert.equal(leaveResponseMessage.receivedType, 'LEAVE_ROOM');
  assert.equal(hostGuestLeaveUpdate.room.playerCount, 1);
  assert.deepEqual(
    hostGuestLeaveUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [{ nickname: 'alpha', isReady: false }],
  );

  const storedRoom = roomsService.findRoomById(room.roomId);
  assert.ok(storedRoom);
  assert.equal(storedRoom?.playerCount, 1);
  assert.deepEqual(
    storedRoom?.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [{ nickname: 'alpha', isReady: false }],
  );

  const events = await prisma.gameEventLog.findMany({
    where: {
      gameId: room.roomId,
    },
    orderBy: {
      seq: 'asc',
    },
  });

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
      'req-room-join-1',
      'req-room-join-2',
      'req-room-ready-1',
      'req-room-ready-2',
      'req-room-leave-1',
    ],
  );

  await prisma.gameEventLog
    .deleteMany({
      where: {
        gameId: room.roomId,
      },
    })
    .catch(() => undefined);

  hostSocket.disconnect();
  guestSocket.disconnect();
});

test('start game rejects when room is too small', async () => {
  const roomsService = app.get(RoomsService);

  const room = roomsService.createRoom({
    hostUserId: 'small-room-host',
    name: 'small-room',
  });

  const host = buildAuthedSocket('small-room-host', 'small-host@example.com');
  const guest1 = buildAuthedSocket('small-room-guest-1', 'small-guest-1@example.com');
  const guest2 = buildAuthedSocket('small-room-guest-2', 'small-guest-2@example.com');

  await Promise.all([
    waitForConnect(host.socket),
    waitForConnect(guest1.socket),
    waitForConnect(guest2.socket),
  ]);

  await joinRoomCommand(host.socket, room.roomId, 'host', 'req-small-join-1');
  await joinRoomCommand(guest1.socket, room.roomId, 'g1', 'req-small-join-2');
  await joinRoomCommand(guest2.socket, room.roomId, 'g2', 'req-small-join-3');

  await readyRoomCommand(host.socket, room.roomId, true, 'req-small-ready-1');
  await readyRoomCommand(guest1.socket, room.roomId, true, 'req-small-ready-2');
  await readyRoomCommand(guest2.socket, room.roomId, true, 'req-small-ready-3');

  const response = await startGameCommand(
    host.socket,
    room.roomId,
    'req-small-start-1',
  );

  assert.equal(response.type, 'COMMAND_REJECTED');
  assert.equal(response.requestId, 'req-small-start-1');
  assert.equal(response.reason, 'ROOM_TOO_SMALL');
  assert.equal(response.message, 'room needs at least 4 players');

  const storedRoom = roomsService.findRoomById(room.roomId);
  assert.ok(storedRoom);
  assert.equal(storedRoom?.status, 'WAITING');

  await prisma.gameEventLog.deleteMany({
    where: {
      gameId: room.roomId,
    },
  });

  host.socket.disconnect();
  guest1.socket.disconnect();
  guest2.socket.disconnect();
});

test('start game rejects non-host, requires all ready, and starts room', async () => {
  const roomsService = app.get(RoomsService);

  const room = roomsService.createRoom({
    hostUserId: 'start-room-host',
    name: 'start-room',
  });

  const host = buildAuthedSocket('start-room-host', 'start-host@example.com');
  const guest1 = buildAuthedSocket('start-room-guest-1', 'start-guest-1@example.com');
  const guest2 = buildAuthedSocket('start-room-guest-2', 'start-guest-2@example.com');
  const guest3 = buildAuthedSocket('start-room-guest-3', 'start-guest-3@example.com');

  await Promise.all([
    waitForConnect(host.socket),
    waitForConnect(guest1.socket),
    waitForConnect(guest2.socket),
    waitForConnect(guest3.socket),
  ]);

  await joinRoomCommand(host.socket, room.roomId, 'host', 'req-start-join-1');
  await joinRoomCommand(guest1.socket, room.roomId, 'g1', 'req-start-join-2');
  await joinRoomCommand(guest2.socket, room.roomId, 'g2', 'req-start-join-3');
  await joinRoomCommand(guest3.socket, room.roomId, 'g3', 'req-start-join-4');

  await readyRoomCommand(host.socket, room.roomId, true, 'req-start-ready-1');
  await readyRoomCommand(guest1.socket, room.roomId, true, 'req-start-ready-2');
  await readyRoomCommand(guest2.socket, room.roomId, true, 'req-start-ready-3');
  await readyRoomCommand(guest3.socket, room.roomId, false, 'req-start-ready-4');

  const notReadyResponse = await startGameCommand(
    host.socket,
    room.roomId,
    'req-start-attempt-1',
  );

  assert.equal(notReadyResponse.type, 'COMMAND_REJECTED');
  assert.equal(notReadyResponse.requestId, 'req-start-attempt-1');
  assert.equal(notReadyResponse.reason, 'ROOM_NOT_READY');
  assert.equal(notReadyResponse.message, 'not all participants are ready');

  await readyRoomCommand(guest3.socket, room.roomId, true, 'req-start-ready-5');

  const nonHostResponse = await startGameCommand(
    guest1.socket,
    room.roomId,
    'req-start-attempt-2',
  );

  assert.equal(nonHostResponse.type, 'COMMAND_REJECTED');
  assert.equal(nonHostResponse.requestId, 'req-start-attempt-2');
  assert.equal(nonHostResponse.reason, 'NOT_ROOM_HOST');
  assert.equal(nonHostResponse.message, 'only host can start game');

  const hostGameStarted = waitForEvent<GameStartedEvent>(
    host.socket,
    'game:started',
  );
  const guestGameStarted = waitForEvent<GameStartedEvent>(
    guest1.socket,
    'game:started',
  );
  const hostRoleAssigned = waitForEvent<RoleAssignedEvent>(
    host.socket,
    'role:assigned',
  );
  const guest1RoleAssigned = waitForEvent<RoleAssignedEvent>(
    guest1.socket,
    'role:assigned',
  );
  const guest2RoleAssigned = waitForEvent<RoleAssignedEvent>(
    guest2.socket,
    'role:assigned',
  );
  const guest3RoleAssigned = waitForEvent<RoleAssignedEvent>(
    guest3.socket,
    'role:assigned',
  );

  const hostSeesStart = waitForEvent<{
    room: {
      roomId: string;
      status: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(host.socket, 'room:updated');
  const guestSeesStart = waitForEvent<{
    room: {
      roomId: string;
      status: string;
      playerCount: number;
      participants: Array<{
        userId: string;
        nickname: string;
        isReady: boolean;
      }>;
    };
  }>(guest1.socket, 'room:updated');

  const startResponse = await startGameCommand(
    host.socket,
    room.roomId,
    'req-start-attempt-3',
  );

  const [hostStartUpdate, guestStartUpdate] = await Promise.all([
    hostSeesStart,
    guestSeesStart,
  ]);
  const [hostGameStartedEvent, guestGameStartedEvent] = await Promise.all([
    hostGameStarted,
    guestGameStarted,
  ]);
  const [hostRoleEvent, guest1RoleEvent, guest2RoleEvent, guest3RoleEvent] =
    await Promise.all([
      hostRoleAssigned,
      guest1RoleAssigned,
      guest2RoleAssigned,
      guest3RoleAssigned,
    ]);

  assert.equal(startResponse.type, 'COMMAND_ACCEPTED');
  assert.equal(startResponse.requestId, 'req-start-attempt-3');
  assert.equal(startResponse.receivedType, 'START_GAME');
  assert.equal(hostGameStartedEvent.type, 'game:started');
  assert.equal(hostGameStartedEvent.gameId, room.roomId);
  assert.equal(hostGameStartedEvent.startedByUserId, 'start-room-host');
  assert.equal(hostGameStartedEvent.startedAt, guestGameStartedEvent.startedAt);
  assert.equal(guestGameStartedEvent.gameId, room.roomId);
  assert.equal(hostStartUpdate.room.status, 'IN_PROGRESS');
  assert.equal(guestStartUpdate.room.status, 'IN_PROGRESS');
  assert.equal(hostStartUpdate.room.playerCount, 4);
  assert.deepEqual(
    hostStartUpdate.room.participants.map((participant) => ({
      nickname: participant.nickname,
      isReady: participant.isReady,
    })),
    [
      { nickname: 'host', isReady: true },
      { nickname: 'g1', isReady: true },
      { nickname: 'g2', isReady: true },
      { nickname: 'g3', isReady: true },
    ],
  );
  assert.deepEqual(
    [
      hostRoleEvent.userId,
      guest1RoleEvent.userId,
      guest2RoleEvent.userId,
      guest3RoleEvent.userId,
    ].sort(),
    [
      'start-room-host',
      'start-room-guest-1',
      'start-room-guest-2',
      'start-room-guest-3',
    ].sort(),
  );
  assert.deepEqual(
    [
      hostRoleEvent.role,
      guest1RoleEvent.role,
      guest2RoleEvent.role,
      guest3RoleEvent.role,
    ].sort(),
    ['CITIZEN', 'DOCTOR', 'MAFIA', 'POLICE'].sort(),
  );

  const storedRoom = roomsService.findRoomById(room.roomId);
  assert.ok(storedRoom);
  assert.equal(storedRoom?.status, 'IN_PROGRESS');
  assert.equal(storedRoom?.playerCount, 4);

  const events = await prisma.gameEventLog.findMany({
    where: {
      gameId: room.roomId,
    },
    orderBy: {
      seq: 'asc',
    },
  });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'PlayerJoined',
      'PlayerJoined',
      'PlayerJoined',
      'PlayerJoined',
      'PlayerReadyChanged',
      'PlayerReadyChanged',
      'PlayerReadyChanged',
      'PlayerReadyChanged',
      'PlayerReadyChanged',
      'GameStarted',
      'RoleAssigned',
      'RoleAssigned',
      'RoleAssigned',
      'RoleAssigned',
    ],
  );
  assert.deepEqual(
    events.map((event) => event.requestId),
    [
      'req-start-join-1',
      'req-start-join-2',
      'req-start-join-3',
      'req-start-join-4',
      'req-start-ready-1',
      'req-start-ready-2',
      'req-start-ready-3',
      'req-start-ready-4',
      'req-start-ready-5',
      'req-start-attempt-3',
      'req-start-attempt-3',
      'req-start-attempt-3',
      'req-start-attempt-3',
      'req-start-attempt-3',
    ],
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === 'RoleAssigned')
      .map((event) => (event.payload as { role: string }).role)
      .sort(),
    ['CITIZEN', 'DOCTOR', 'MAFIA', 'POLICE'].sort(),
  );

  await prisma.gameEventLog.deleteMany({
    where: {
      gameId: room.roomId,
    },
  });

  host.socket.disconnect();
  guest1.socket.disconnect();
  guest2.socket.disconnect();
  guest3.socket.disconnect();
});
