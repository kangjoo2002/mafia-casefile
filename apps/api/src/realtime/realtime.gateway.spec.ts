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
