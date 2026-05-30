import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryRoomRepository } from './in-memory-room.repository';
import { RoomsService } from './rooms.service';

test('process-local Room 저장소는 다른 RoomsService 인스턴스와 room을 공유하지 않는다', async () => {
  const apiInstance1Rooms = new RoomsService(new InMemoryRoomRepository());
  const apiInstance2Rooms = new RoomsService(new InMemoryRoomRepository());

  const room = await apiInstance1Rooms.createRoom({
    hostUserId: 'host-user',
    name: 'multi-instance-room',
    maxPlayers: 4,
  });

  assert.equal((await apiInstance1Rooms.findRoomById(room.roomId))?.roomId, room.roomId);
  assert.equal(await apiInstance2Rooms.findRoomById(room.roomId), null);

  await assert.rejects(
    () =>
      apiInstance2Rooms.joinRoom(room.roomId, {
        userId: 'guest-user',
        nickname: 'guest',
      }),
    /room not found/,
  );
});
