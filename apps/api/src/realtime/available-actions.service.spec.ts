import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type {
  AvailableAction,
  GamePhase,
  PlayerStatus,
  Role,
  ConnectionStatus,
} from '@mafia-casefile/shared';
import { AvailableActionsService } from './available-actions.service';
import type { GameSession } from '../game-session/game-session';

const service = new AvailableActionsService();

function createPlayer(input: {
  userId: string;
  role: Role;
  status?: PlayerStatus;
  connectionStatus?: ConnectionStatus;
}) {
  return {
    userId: input.userId,
    nickname: input.userId,
    role: input.role,
    status: input.status ?? 'ALIVE',
    connectionStatus: input.connectionStatus ?? 'CONNECTED',
    lastSeenAt: new Date('2026-05-16T00:00:00.000Z'),
  };
}

function createSession(input: {
  phase: GamePhase;
  hostUserId: string;
  players: ReturnType<typeof createPlayer>[];
}): GameSession {
  const now = new Date('2026-05-16T00:00:00.000Z');

  return {
    gameId: randomUUID(),
    roomId: randomUUID(),
    phase: input.phase,
    turn: 1,
    version: 1,
    hostUserId: input.hostUserId,
    players: input.players,
    votes: {},
    nightActions: {},
    phaseEndsAt: null,
    processedRequests: {},
    createdAt: now,
    updatedAt: now,
  };
}

function summarize(actions: AvailableAction[]) {
  return actions.map((action) => ({
    type: action.type,
    channel: action.channel,
    targetUserIds: action.targetUserIds,
  }));
}

test('session에 player가 없으면 availableActions는 빈 배열이다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [createPlayer({ userId: 'host-user', role: 'CITIZEN' })],
  });

  assert.deepEqual(
    service.buildForPlayer({ session, userId: 'missing-user' }),
    [],
  );
});

test('DISCONNECTED player는 availableActions가 없다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [
      createPlayer({
        userId: 'host-user',
        role: 'CITIZEN',
      }),
      createPlayer({
        userId: 'guest-user',
        role: 'CITIZEN',
        connectionStatus: 'DISCONNECTED',
      }),
    ],
  });

  assert.deepEqual(
    service.buildForPlayer({ session, userId: 'guest-user' }),
    [],
  );
});

test('FINISHED phase는 availableActions가 없다', () => {
  const session = createSession({
    phase: 'FINISHED',
    hostUserId: 'host-user',
    players: [createPlayer({ userId: 'host-user', role: 'CITIZEN' })],
  });

  assert.deepEqual(
    service.buildForPlayer({ session, userId: 'host-user' }),
    [],
  );
});

test('host도 phase 수동 진행 action은 받지 않는다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [createPlayer({ userId: 'host-user', role: 'CITIZEN' })],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'host-user' })), [
    { type: 'SEND_CHAT_MESSAGE', channel: 'DAY', targetUserIds: undefined },
  ]);
});

test('non-host는 NEXT_PHASE를 받지 않는다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'guest-user', role: 'CITIZEN' }),
    ],
  });

  const actions = summarize(
    service.buildForPlayer({ session, userId: 'guest-user' }),
  );

  assert.equal(
    actions.some((action) => action.type === 'NEXT_PHASE'),
    false,
  );
  assert.deepEqual(actions, [
    { type: 'SEND_CHAT_MESSAGE', channel: 'DAY', targetUserIds: undefined },
  ]);
});

test('NIGHT phase의 살아있는 MAFIA는 night action과 mafia chat을 받는다', () => {
  const session = createSession({
    phase: 'NIGHT',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'mafia-user', role: 'MAFIA' }),
      createPlayer({ userId: 'citizen-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'dead-user', role: 'CITIZEN', status: 'DEAD' }),
    ],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'mafia-user' })), [
    {
      type: 'SELECT_MAFIA_TARGET',
      channel: undefined,
      targetUserIds: ['host-user', 'citizen-user'],
    },
    {
      type: 'SEND_CHAT_MESSAGE',
      channel: 'MAFIA',
      targetUserIds: undefined,
    },
  ]);
});

test('NIGHT phase의 살아있는 DOCTOR는 doctor target action을 받는다', () => {
  const session = createSession({
    phase: 'NIGHT',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'doctor-user', role: 'DOCTOR' }),
      createPlayer({ userId: 'dead-user', role: 'CITIZEN', status: 'DEAD' }),
    ],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'doctor-user' })), [
    {
      type: 'SELECT_DOCTOR_TARGET',
      channel: undefined,
      targetUserIds: ['host-user', 'doctor-user'],
    },
  ]);
});

test('NIGHT phase의 살아있는 POLICE는 police target action을 받는다', () => {
  const session = createSession({
    phase: 'NIGHT',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'police-user', role: 'POLICE' }),
      createPlayer({ userId: 'dead-user', role: 'CITIZEN', status: 'DEAD' }),
    ],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'police-user' })), [
    {
      type: 'SELECT_POLICE_TARGET',
      channel: undefined,
      targetUserIds: ['host-user'],
    },
  ]);
});

test('DAY_DISCUSSION phase의 살아있는 player는 DAY chat을 받는다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'guest-user', role: 'CITIZEN' }),
    ],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'guest-user' })), [
    {
      type: 'SEND_CHAT_MESSAGE',
      channel: 'DAY',
      targetUserIds: undefined,
    },
  ]);
});

test('VOTING phase의 살아있는 player는 CAST_VOTE를 받는다', () => {
  const session = createSession({
    phase: 'VOTING',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'guest-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'dead-user', role: 'CITIZEN', status: 'DEAD' }),
    ],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'guest-user' })), [
    {
      type: 'CAST_VOTE',
      channel: undefined,
      targetUserIds: ['host-user', 'guest-user'],
    },
  ]);
});

test('죽은 player는 GHOST chat만 받는다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'dead-user', role: 'CITIZEN', status: 'DEAD' }),
      createPlayer({ userId: 'guest-user', role: 'CITIZEN' }),
    ],
  });

  assert.deepEqual(summarize(service.buildForPlayer({ session, userId: 'dead-user' })), [
    {
      type: 'SEND_CHAT_MESSAGE',
      channel: 'GHOST',
      targetUserIds: undefined,
    },
  ]);
});

test('죽은 player는 CAST_VOTE, 밤 액션, DAY chat을 받지 않는다', () => {
  const session = createSession({
    phase: 'VOTING',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'dead-user', role: 'MAFIA', status: 'DEAD' }),
      createPlayer({ userId: 'guest-user', role: 'CITIZEN' }),
    ],
  });

  assert.deepEqual(
    service.buildForPlayer({ session, userId: 'dead-user' }),
    [
      {
        type: 'SEND_CHAT_MESSAGE',
        channel: 'GHOST',
      },
    ],
  );
});

test('target action의 targetUserIds는 살아있는 player만 포함한다', () => {
  const session = createSession({
    phase: 'NIGHT',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'mafia-user', role: 'MAFIA' }),
      createPlayer({ userId: 'alive-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'dead-user', role: 'CITIZEN', status: 'DEAD' }),
    ],
  });

  const mafiaActions = summarize(
    service.buildForPlayer({ session, userId: 'mafia-user' }),
  );

  assert.deepEqual(mafiaActions[0], {
    type: 'SELECT_MAFIA_TARGET',
    channel: undefined,
    targetUserIds: ['host-user', 'alive-user'],
  });
  assert.equal(mafiaActions[0]?.targetUserIds?.includes('dead-user'), false);
  assert.equal(mafiaActions[0]?.targetUserIds?.includes('mafia-user'), false);
});

test('LOBBY, SYSTEM, END chat action은 포함하지 않는다', () => {
  const session = createSession({
    phase: 'DAY_DISCUSSION',
    hostUserId: 'host-user',
    players: [
      createPlayer({ userId: 'host-user', role: 'CITIZEN' }),
      createPlayer({ userId: 'guest-user', role: 'CITIZEN' }),
    ],
  });

  const channels = service
    .buildForPlayer({ session, userId: 'guest-user' })
    .map((action) => action.channel);

  assert.equal(channels.some((channel) => channel === 'LOBBY'), false);
  assert.equal(channels.some((channel) => channel === 'SYSTEM'), false);
  assert.equal(channels.some((channel) => String(channel) === 'END'), false);
});
