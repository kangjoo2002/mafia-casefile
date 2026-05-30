import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server as SocketServer } from 'socket.io';
import { io, type Socket } from 'socket.io-client';

const sockets: Socket[] = [];
const socketServers: SocketServer[] = [];
const httpServers: HttpServer[] = [];
const redisClients: Redis[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }

  await Promise.all(
    socketServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );

  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );

  await Promise.all(redisClients.splice(0).map((client) => client.quit()));
});

test('기본 Socket.IO adapter는 다른 server instance에 연결된 socket으로 broadcast하지 않는다', async () => {
  const instance1 = await createSocketInstance();
  const instance2 = await createSocketInstance();
  const roomId = 'room:multi-instance';
  const clientOnInstance1 = connectClient(instance1.url);
  const clientOnInstance2 = connectClient(instance2.url);

  await Promise.all([
    waitForConnect(clientOnInstance1),
    waitForConnect(clientOnInstance2),
  ]);

  await Promise.all([
    joinTestRoom(clientOnInstance1, roomId),
    joinTestRoom(clientOnInstance2, roomId),
  ]);

  const sameInstanceEvent = waitForEvent<{ roomId: string }>(
    clientOnInstance1,
    'room:updated',
  );
  const otherInstanceEvent = assertNoEvent(clientOnInstance2, 'room:updated');

  instance1.io.to(roomId).emit('room:updated', { roomId });

  assert.deepEqual(await sameInstanceEvent, { roomId });
  await otherInstanceEvent;
});

test('Redis Socket.IO adapter는 다른 server instance에 연결된 socket에도 broadcast한다', async () => {
  const adapterKey = `mafia-casefile-test:${randomUUID()}:socket.io`;
  const instance1 = await createSocketInstance({ adapterKey });
  const instance2 = await createSocketInstance({ adapterKey });
  const roomId = 'room:multi-instance:redis';
  const clientOnInstance1 = connectClient(instance1.url);
  const clientOnInstance2 = connectClient(instance2.url);

  await Promise.all([
    waitForConnect(clientOnInstance1),
    waitForConnect(clientOnInstance2),
  ]);

  await Promise.all([
    joinTestRoom(clientOnInstance1, roomId),
    joinTestRoom(clientOnInstance2, roomId),
  ]);

  await wait(50);

  const sameInstanceEvent = waitForEvent<{ roomId: string }>(
    clientOnInstance1,
    'room:updated',
  );
  const otherInstanceEvent = waitForEvent<{ roomId: string }>(
    clientOnInstance2,
    'room:updated',
  );

  instance1.io.to(roomId).emit('room:updated', { roomId });

  assert.deepEqual(await sameInstanceEvent, { roomId });
  assert.deepEqual(await otherInstanceEvent, { roomId });
});

async function createSocketInstance(options: { adapterKey?: string } = {}) {
  const httpServer = createServer();
  const ioServer = new SocketServer(httpServer, {
    cors: {
      origin: '*',
    },
  });

  if (options.adapterKey) {
    const pubClient = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const subClient = pubClient.duplicate();
    redisClients.push(pubClient, subClient);

    await Promise.all([pubClient.ping(), subClient.ping()]);

    ioServer.adapter(
      createAdapter(pubClient, subClient, {
        key: options.adapterKey,
      }),
    );
  }

  ioServer.on('connection', (socket) => {
    socket.on(
      'join-test-room',
      async (roomId: string, ack?: (response: { ok: boolean }) => void) => {
        await socket.join(roomId);
        ack?.({ ok: true });
      },
    );
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address();
  assert.ok(address && typeof address !== 'string');

  socketServers.push(ioServer);
  httpServers.push(httpServer);

  return {
    io: ioServer,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function connectClient(url: string) {
  const socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
  });

  sockets.push(socket);
  return socket;
}

async function waitForConnect(socket: Socket) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('socket connect timed out'));
    }, 1000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function joinTestRoom(socket: Socket, roomId: string) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('join-test-room timed out'));
    }, 1000);

    socket.emit(
      'join-test-room',
      roomId,
      (response: { ok: boolean } | undefined) => {
        clearTimeout(timeout);

        if (response?.ok) {
          resolve();
          return;
        }

        reject(new Error('join-test-room failed'));
      },
    );
  });
}

async function waitForEvent<T>(socket: Socket, eventName: string) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`${eventName} timed out`));
    }, 1000);

    const handler = (message: T) => {
      clearTimeout(timeout);
      resolve(message);
    };

    socket.once(eventName, handler);
  });
}

async function assertNoEvent(socket: Socket, eventName: string) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      resolve();
    }, 100);

    const handler = (message: unknown) => {
      clearTimeout(timeout);
      reject(
        new Error(`${eventName} should not be emitted: ${JSON.stringify(message)}`),
      );
    };

    socket.once(eventName, handler);
  });
}
