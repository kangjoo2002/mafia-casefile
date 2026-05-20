import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersonalEventChannelService } from './personal-event-channel.service';

test('userRoom은 user:{userId} 형식을 반환한다', () => {
  const service = new PersonalEventChannelService();

  assert.equal(service.userRoom('user-1'), 'user:user-1');
});

test('joinUserRoom은 socket.join에 user room을 전달한다', async () => {
  const service = new PersonalEventChannelService();
  const calls: string[] = [];
  const client = {
    join: async (room: string) => {
      calls.push(room);
    },
  } as const;

  await service.joinUserRoom(client as any, 'user-2');

  assert.deepEqual(calls, ['user:user-2']);
});

test('emitToUser는 server.to(user room).emit을 호출한다', () => {
  const service = new PersonalEventChannelService();
  const calls: Array<{ room: string; eventName: string; payload: unknown }> = [];
  const server = {
    to: (room: string) => ({
      emit: (eventName: string, payload: unknown) => {
        calls.push({ room, eventName, payload });
      },
    }),
  } as const;

  service.emitToUser(server as any, 'user-3', 'role:assigned', {
    type: 'role:assigned',
  });

  assert.deepEqual(calls, [
    {
      room: 'user:user-3',
      eventName: 'role:assigned',
      payload: {
        type: 'role:assigned',
      },
    },
  ]);
});

test('emitToSocket는 client.emit을 호출한다', () => {
  const service = new PersonalEventChannelService();
  const calls: Array<{ eventName: string; payload: unknown }> = [];
  const client = {
    emit: (eventName: string, payload: unknown) => {
      calls.push({ eventName, payload });
    },
  } as const;

  service.emitToSocket(client as any, 'command:accepted', {
    type: 'COMMAND_ACCEPTED',
  });

  assert.deepEqual(calls, [
    {
      eventName: 'command:accepted',
      payload: {
        type: 'COMMAND_ACCEPTED',
      },
    },
  ]);
});
