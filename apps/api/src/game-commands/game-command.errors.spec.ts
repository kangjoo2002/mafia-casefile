import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMAND_REJECT_MESSAGES,
  COMMAND_REJECT_REASONS,
  getCommandRejectMessage,
  isCommandRejectReason,
} from './game-command.errors';

test('COMMAND_REJECT_REASONS에 중복이 없다', () => {
  assert.equal(new Set(COMMAND_REJECT_REASONS).size, COMMAND_REJECT_REASONS.length);
});

test('모든 COMMAND_REJECT_REASONS에 기본 message가 있다', () => {
  for (const reason of COMMAND_REJECT_REASONS) {
    assert.equal(typeof COMMAND_REJECT_MESSAGES[reason], 'string');
    assert.ok(COMMAND_REJECT_MESSAGES[reason].length > 0);
  }
});

test('isCommandRejectReason은 known code를 true로 반환한다', () => {
  for (const reason of COMMAND_REJECT_REASONS) {
    assert.equal(isCommandRejectReason(reason), true);
  }
});

test('isCommandRejectReason은 unknown string을 false로 반환한다', () => {
  assert.equal(isCommandRejectReason('NOT_A_REAL_REASON'), false);
});

test('getCommandRejectMessage는 비어 있지 않은 string을 반환한다', () => {
  for (const reason of COMMAND_REJECT_REASONS) {
    const message = getCommandRejectMessage(reason);
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0);
  }
});
