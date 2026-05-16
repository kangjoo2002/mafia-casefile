import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '../auth/jwt.service';
import { RealtimeModule } from './realtime.module';
import { io, Socket } from 'socket.io-client';

process.env.JWT_SECRET = 'test-secret';

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let client: Socket | undefined;

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

before(async () => {
  app = await NestFactory.create(RealtimeTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');
});

after(async () => {
  client?.disconnect();
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
