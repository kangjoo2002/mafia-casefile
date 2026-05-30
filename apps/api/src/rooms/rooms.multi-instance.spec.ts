import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoomsService } from './rooms.service';

test('process-local Room Map은 다른 RoomsService 인스턴스와 room을 공유하지 않는다', () => {
  const apiInstance1Rooms = new RoomsService();
  const apiInstance2Rooms = new RoomsService();

  const room = apiInstance1Rooms.createRoom({
    hostUserId: 'host-user',
    name: 'multi-instance-room',
    maxPlayers: 4,
  });

  assert.equal(apiInstance1Rooms.findRoomById(room.roomId)?.roomId, room.roomId);
  assert.equal(apiInstance2Rooms.findRoomById(room.roomId), null);

  assert.throws(
    () =>
      apiInstance2Rooms.joinRoom(room.roomId, {
        userId: 'guest-user',
        nickname: 'guest',
      }),
    /room not found/,
  );
});
