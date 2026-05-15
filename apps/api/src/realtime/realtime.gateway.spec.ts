import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, Socket } from 'socket.io-client';
import { RealtimeModule } from './realtime.module';

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let client: Socket;

@Module({
  imports: [RealtimeModule],
})
class RealtimeTestModule {}

before(async () => {
  app = await NestFactory.create(RealtimeTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');
});

after(async () => {
  if (client) {
    client.disconnect();
  }

  if (app) {
    await app.close();
  }
});

test('ping emits pong', async () => {
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test port');
  }

  const url = `http://127.0.0.1:${address.port}`;

  client = io(url, {
    transports: ['websocket'],
    forceNew: true,
  });

  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });

  const pong = await new Promise<{ type: string; timestamp: string }>((resolve, reject) => {
    client.once('pong', resolve);
    client.once('connect_error', reject);
    client.emit('ping');
  });

  assert.equal(pong.type, 'pong');
  assert.equal(typeof pong.timestamp, 'string');
  assert.ok(pong.timestamp.length > 0);
});
