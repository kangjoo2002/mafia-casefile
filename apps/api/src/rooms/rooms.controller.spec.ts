import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RoomsModule } from './rooms.module';

@Module({
  imports: [RoomsModule],
})
class RoomsTestModule {}

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

function getBaseUrl() {
  const address = app?.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test port');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, getBaseUrl()), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text.length > 0 ? JSON.parse(text) : null;

  return {
    status: response.status,
    body,
  };
}

beforeEach(async () => {
  app = await NestFactory.create(RoomsTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

test('creates a room', async () => {
  const response = await request('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      hostUserId: 'host-user-1',
    }),
  });

  assert.equal(response.status, 201);
  assert.ok(response.body);
  assert.equal(response.body.room.hostUserId, 'host-user-1');
  assert.equal(response.body.room.name, '새 방');
  assert.equal(response.body.room.status, 'WAITING');
  assert.equal(response.body.room.playerCount, 1);
  assert.equal(response.body.room.maxPlayers, 8);
  assert.equal(typeof response.body.room.roomId, 'string');
  assert.equal(typeof response.body.room.createdAt, 'string');
  assert.equal(typeof response.body.room.updatedAt, 'string');
});

test('lists rooms in newest-first order', async () => {
  const first = await request('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      hostUserId: 'host-user-1',
      name: '첫 번째 방',
    }),
  });
  const second = await request('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      hostUserId: 'host-user-2',
      name: '두 번째 방',
    }),
  });

  const response = await request('/rooms');

  assert.equal(response.status, 200);
  assert.equal(response.body.rooms.length, 2);
  assert.equal(response.body.rooms[0].roomId, second.body.room.roomId);
  assert.equal(response.body.rooms[1].roomId, first.body.room.roomId);
});

test('returns room details', async () => {
  const created = await request('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      hostUserId: 'host-user-3',
      name: '상세 조회 방',
    }),
  });

  const response = await request(`/rooms/${created.body.room.roomId}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.room, created.body.room);
});

test('returns 404 for missing room', async () => {
  const response = await request('/rooms/missing-room-id');

  assert.equal(response.status, 404);
  assert.equal(response.body.message, 'room not found');
});
