import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CommandRejectedEvent } from '@mafia-casefile/shared';
import { parseCommandEnvelope } from './command-envelope';

function assertRejected(
  result: ReturnType<typeof parseCommandEnvelope>,
): asserts result is CommandRejectedEvent {
  assert.equal(result.type, 'COMMAND_REJECTED');
}

test('payload가 object가 아니면 INVALID_COMMAND_ENVELOPE', () => {
  const result = parseCommandEnvelope(null);

  assertRejected(result);
  assert.equal(result.reason, 'INVALID_COMMAND_ENVELOPE');
});

test('requestId가 없으면 INVALID_COMMAND_ENVELOPE', () => {
  const result = parseCommandEnvelope({
    type: 'JOIN_ROOM',
    gameId: 'game-1',
    payload: {},
  });

  assertRejected(result);
  assert.equal(result.reason, 'INVALID_COMMAND_ENVELOPE');
  assert.equal(result.requestId, undefined);
});

test('type이 없으면 INVALID_COMMAND_ENVELOPE', () => {
  const result = parseCommandEnvelope({
    requestId: 'req-1',
    gameId: 'game-1',
    payload: {},
  });

  assertRejected(result);
  assert.equal(result.reason, 'INVALID_COMMAND_ENVELOPE');
});

test('gameId가 없으면 INVALID_COMMAND_ENVELOPE', () => {
  const result = parseCommandEnvelope({
    type: 'JOIN_ROOM',
    requestId: 'req-1',
    payload: {},
  });

  assertRejected(result);
  assert.equal(result.reason, 'INVALID_COMMAND_ENVELOPE');
});

test('payload가 없으면 INVALID_COMMAND_ENVELOPE', () => {
  const result = parseCommandEnvelope({
    type: 'JOIN_ROOM',
    requestId: 'req-1',
    gameId: 'game-1',
  });

  assertRejected(result);
  assert.equal(result.reason, 'INVALID_COMMAND_ENVELOPE');
});

test('valid envelope는 command envelope로 반환된다', () => {
  const result = parseCommandEnvelope({
    type: 'JOIN_ROOM',
    requestId: 'req-1',
    gameId: 'game-1',
    payload: {
      nickname: 'alpha',
    },
  });

  assert.equal(result.type, 'JOIN_ROOM');
  assert.equal(result.requestId, 'req-1');
  assert.equal(result.gameId, 'game-1');
  assert.deepEqual(result.payload, {
    nickname: 'alpha',
  });
});
