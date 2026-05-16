import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
      participants: Array<{ userId: string; nickname: string }>;
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
    hostRoomUpdatedMessage.room.participants.map((participant) => participant.nickname),
    ['alpha'],
  );

  const hostSeesGuestJoin = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{ userId: string; nickname: string }>;
    };
  }>(hostSocket, 'room:updated');
  const guestSeesGuestJoin = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{ userId: string; nickname: string }>;
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
    guestGuestJoinUpdate.room.participants.map((participant) => participant.nickname),
    ['alpha', 'bravo'],
  );

  const hostSeesGuestLeave = waitForEvent<{
    room: {
      roomId: string;
      playerCount: number;
      participants: Array<{ userId: string; nickname: string }>;
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
    hostGuestLeaveUpdate.room.participants.map((participant) => participant.nickname),
    ['alpha'],
  );

  const storedRoom = roomsService.findRoomById(room.roomId);
  assert.ok(storedRoom);
  assert.equal(storedRoom?.playerCount, 1);
  assert.deepEqual(
    storedRoom?.participants.map((participant) => participant.nickname),
    ['alpha'],
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
    ['PlayerJoined', 'PlayerJoined', 'PlayerLeft'],
  );
  assert.deepEqual(
    events.map((event) => event.requestId),
    ['req-room-join-1', 'req-room-join-2', 'req-room-leave-1'],
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
