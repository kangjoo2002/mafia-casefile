import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type {
  GameStartedEvent,
  PhaseChangedEvent,
  RoleAssignedEvent,
  Role,
} from '@mafia-casefile/shared';
import { JwtService } from '../auth/jwt.service';
import { GameSessionService } from '../game-session/game-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { RealtimeModule } from './realtime.module';
import { io, Socket } from 'socket.io-client';

process.env.JWT_SECRET = 'test-secret';

let app: Awaited<ReturnType<typeof NestFactory.create>>;
const prisma = new PrismaService();

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

function connectClient(auth: { token: string }) {
  const socket = io(getUrl(), {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: false,
    auth,
  });

  socket.auth = auth;
  (socket.io.opts as any).auth = auth;
  socket.connect();
  return socket;
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

async function waitForEvent<T>(socket: Socket, eventName: string) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`${eventName} timed out`));
    }, 2000);

    const handler = (message: T) => {
      clearTimeout(timeout);
      resolve(message);
    };

    socket.once(eventName, handler);
  });
}

async function sendCommandAndWait<T>(socket: Socket, command: unknown) {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('command response timed out'));
    }, 2000);

    const acceptedHandler = (message: T) => {
      clearTimeout(timeout);
      socket.off('command:rejected', rejectedHandler);
      resolve(message);
    };

    const rejectedHandler = (message: T) => {
      clearTimeout(timeout);
      socket.off('command:accepted', acceptedHandler);
      resolve(message);
    };

    socket.once('command:accepted', acceptedHandler);
    socket.once('command:rejected', rejectedHandler);
    socket.emit('command', command);
  });
}

function buildAuthedSocket(userId: string, email: string) {
  const jwtService = new JwtService();
  const token = jwtService.signAccessToken({ id: userId, email });

  return {
    userId,
    socket: connectClient({ token }),
  };
}

function joinRoomCommand(
  socket: Socket,
  roomId: string,
  nickname: string,
  requestId: string,
) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'JOIN_ROOM',
    requestId,
    gameId: roomId,
    payload: { nickname },
  });
}

function readyRoomCommand(
  socket: Socket,
  roomId: string,
  isReady: boolean,
  requestId: string,
) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'CHANGE_READY',
    requestId,
    gameId: roomId,
    payload: { isReady },
  });
}

function startGameCommand(socket: Socket, roomId: string, requestId: string) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'START_GAME',
    requestId,
    gameId: roomId,
    payload: {},
  });
}

function nextPhaseCommand(socket: Socket, roomId: string, requestId: string) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'NEXT_PHASE',
    requestId,
    gameId: roomId,
    payload: {},
  });
}

function nightActionCommand(
  socket: Socket,
  type: 'SELECT_MAFIA_TARGET' | 'SELECT_DOCTOR_TARGET' | 'SELECT_POLICE_TARGET',
  roomId: string,
  targetUserId: string,
  requestId: string,
) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type,
    requestId,
    gameId: roomId,
    payload: { targetUserId },
  });
}

function voteCommand(
  socket: Socket,
  roomId: string,
  targetUserId: string,
  requestId: string,
) {
  return sendCommandAndWait<{
    type: string;
    requestId: string;
    receivedType?: string;
    reason?: string;
    message?: string;
  }>(socket, {
    type: 'CAST_VOTE',
    requestId,
    gameId: roomId,
    payload: { targetUserId },
  });
}

before(async () => {
  await prisma.$connect();
  app = await NestFactory.create(RealtimeTestModule, {
    logger: false,
  });

  await app.listen(0, '127.0.0.1');
});

after(async () => {
  await prisma.$disconnect();
  await app.close();
});

test('game flow e2e covers a full citizen win', async () => {
  const roomsService = app.get(RoomsService);
  const gameSessionService = app.get(GameSessionService);

  const room = roomsService.createRoom({
    hostUserId: 'e2e-host',
    name: 'e2e-game-flow',
  });

  const host = buildAuthedSocket('e2e-host', 'host@example.com');
  const guest1 = buildAuthedSocket('e2e-guest-1', 'guest-1@example.com');
  const guest2 = buildAuthedSocket('e2e-guest-2', 'guest-2@example.com');
  const guest3 = buildAuthedSocket('e2e-guest-3', 'guest-3@example.com');

  const socketsByUserId = new Map<string, Socket>([
    [host.userId, host.socket],
    [guest1.userId, guest1.socket],
    [guest2.userId, guest2.socket],
    [guest3.userId, guest3.socket],
  ]);

  try {
    await Promise.all([
      waitForConnect(host.socket),
      waitForConnect(guest1.socket),
      waitForConnect(guest2.socket),
      waitForConnect(guest3.socket),
    ]);

    await joinRoomCommand(host.socket, room.roomId, 'host', 'req-e2e-join-1');
    await joinRoomCommand(guest1.socket, room.roomId, 'guest-1', 'req-e2e-join-2');
    await joinRoomCommand(guest2.socket, room.roomId, 'guest-2', 'req-e2e-join-3');
    await joinRoomCommand(guest3.socket, room.roomId, 'guest-3', 'req-e2e-join-4');

    await readyRoomCommand(host.socket, room.roomId, true, 'req-e2e-ready-1');
    await readyRoomCommand(guest1.socket, room.roomId, true, 'req-e2e-ready-2');
    await readyRoomCommand(guest2.socket, room.roomId, true, 'req-e2e-ready-3');
    await readyRoomCommand(guest3.socket, room.roomId, true, 'req-e2e-ready-4');

    const gameStartedPromise = waitForEvent<GameStartedEvent>(
      host.socket,
      'game:started',
    );
    const rolePromises = [
      waitForEvent<RoleAssignedEvent>(host.socket, 'role:assigned'),
      waitForEvent<RoleAssignedEvent>(guest1.socket, 'role:assigned'),
      waitForEvent<RoleAssignedEvent>(guest2.socket, 'role:assigned'),
      waitForEvent<RoleAssignedEvent>(guest3.socket, 'role:assigned'),
    ];

    const startResponsePromise = startGameCommand(
      host.socket,
      room.roomId,
      'req-e2e-start',
    );

    const [startResponse, gameStartedEvent, ...roleEvents] = await Promise.all([
      startResponsePromise,
      gameStartedPromise,
      ...rolePromises,
    ]);

    assert.equal(startResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(startResponse.receivedType, 'START_GAME');
    assert.equal(gameStartedEvent.type, 'game:started');
    assert.equal(gameStartedEvent.gameId, room.roomId);
    assert.equal(gameStartedEvent.startedByUserId, host.userId);

    const roleByUserId = new Map<string, Role>(
      roleEvents.map((event) => [event.userId, event.role]),
    );

    assert.equal(roleByUserId.size, 4);
    assert.deepEqual(
      [...roleByUserId.values()].sort(),
      ['CITIZEN', 'DOCTOR', 'MAFIA', 'POLICE'].sort(),
    );

    const startedSession = await gameSessionService.findByGameId(room.roomId);
    assert.ok(startedSession);
    assert.equal(startedSession?.phase, 'NIGHT');

    const mafiaUserId = [...roleByUserId.entries()].find(
      ([, role]) => role === 'MAFIA',
    )?.[0];
    const doctorUserId = [...roleByUserId.entries()].find(
      ([, role]) => role === 'DOCTOR',
    )?.[0];
    const policeUserId = [...roleByUserId.entries()].find(
      ([, role]) => role === 'POLICE',
    )?.[0];
    const citizenUserId = [...roleByUserId.entries()].find(
      ([, role]) => role === 'CITIZEN',
    )?.[0];

    assert.ok(mafiaUserId);
    assert.ok(doctorUserId);
    assert.ok(policeUserId);
    assert.ok(citizenUserId);

    const mafiaSocket = socketsByUserId.get(mafiaUserId!);
    const doctorSocket = socketsByUserId.get(doctorUserId!);
    const policeSocket = socketsByUserId.get(policeUserId!);
    const citizenSocket = socketsByUserId.get(citizenUserId!);

    assert.ok(mafiaSocket);
    assert.ok(doctorSocket);
    assert.ok(policeSocket);
    assert.ok(citizenSocket);

    const mafiaTargetUserId = citizenUserId!;
    const doctorTargetUserId = mafiaUserId!;
    const policeTargetUserId = mafiaUserId!;

    const mafiaTargetResponse = await nightActionCommand(
      mafiaSocket!,
      'SELECT_MAFIA_TARGET',
      room.roomId,
      mafiaTargetUserId,
      'req-e2e-night-mafia',
    );
    const doctorTargetResponse = await nightActionCommand(
      doctorSocket!,
      'SELECT_DOCTOR_TARGET',
      room.roomId,
      doctorTargetUserId,
      'req-e2e-night-doctor',
    );
    const policeTargetResponse = await nightActionCommand(
      policeSocket!,
      'SELECT_POLICE_TARGET',
      room.roomId,
      policeTargetUserId,
      'req-e2e-night-police',
    );

    assert.equal(mafiaTargetResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(doctorTargetResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(policeTargetResponse.type, 'COMMAND_ACCEPTED');

    const nonHostSocket = [...socketsByUserId.entries()].find(
      ([userId]) => userId !== host.userId,
    )?.[1];
    assert.ok(nonHostSocket);

    const rejectedPhaseResponse = await nextPhaseCommand(
      nonHostSocket!,
      room.roomId,
      'req-e2e-next-rejected',
    );

    assert.equal(rejectedPhaseResponse.type, 'COMMAND_REJECTED');
    assert.equal(rejectedPhaseResponse.reason, 'NOT_ROOM_HOST');
    assert.equal(rejectedPhaseResponse.message, 'not room host');

    const phaseNightPromise = waitForEvent<PhaseChangedEvent>(
      host.socket,
      'phase:changed',
    );
    const nightPhaseResponse = await nextPhaseCommand(
      host.socket,
      room.roomId,
      'req-e2e-next-night',
    );
    const nightPhaseBroadcast = await phaseNightPromise;

    assert.equal(nightPhaseResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(nightPhaseBroadcast.fromPhase, 'NIGHT');
    assert.equal(nightPhaseBroadcast.toPhase, 'DAY_DISCUSSION');

    const afterNightSession = await gameSessionService.findByGameId(room.roomId);
    assert.equal(afterNightSession?.phase, 'DAY_DISCUSSION');

    const phaseDayPromise = waitForEvent<PhaseChangedEvent>(
      host.socket,
      'phase:changed',
    );
    const dayPhaseResponse = await nextPhaseCommand(
      host.socket,
      room.roomId,
      'req-e2e-next-day',
    );
    const dayPhaseBroadcast = await phaseDayPromise;

    assert.equal(dayPhaseResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(dayPhaseBroadcast.fromPhase, 'DAY_DISCUSSION');
    assert.equal(dayPhaseBroadcast.toPhase, 'VOTING');

    const votingSession = await gameSessionService.findByGameId(room.roomId);
    assert.ok(votingSession);
    assert.equal(votingSession?.phase, 'VOTING');

    const doctorVoteResponse = await voteCommand(
      doctorSocket!,
      room.roomId,
      mafiaUserId!,
      'req-e2e-vote-doctor',
    );
    const policeVoteResponse = await voteCommand(
      policeSocket!,
      room.roomId,
      mafiaUserId!,
      'req-e2e-vote-police',
    );
    const mafiaVoteResponse = await voteCommand(
      mafiaSocket!,
      room.roomId,
      doctorUserId!,
      'req-e2e-vote-mafia',
    );

    assert.equal(doctorVoteResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(policeVoteResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(mafiaVoteResponse.type, 'COMMAND_ACCEPTED');

    const phaseVotingPromise = waitForEvent<PhaseChangedEvent>(
      host.socket,
      'phase:changed',
    );
    const votingPhaseResponse = await nextPhaseCommand(
      host.socket,
      room.roomId,
      'req-e2e-next-voting',
    );
    const votingPhaseBroadcast = await phaseVotingPromise;

    assert.equal(votingPhaseResponse.type, 'COMMAND_ACCEPTED');
    assert.equal(votingPhaseBroadcast.fromPhase, 'VOTING');
    assert.equal(votingPhaseBroadcast.toPhase, 'RESULT');

    const finalSession = await gameSessionService.findByGameId(room.roomId);
    assert.ok(finalSession);
    assert.equal(finalSession?.phase, 'FINISHED');

    const events = await prisma.gameEventLog.findMany({
      where: { gameId: room.roomId },
      orderBy: { seq: 'asc' },
    });

    assert.ok(events.length > 0);
    events.forEach((event, index) => {
      assert.equal(event.seq, index + 1);
    });

    assert.deepEqual(
      events.map((event) => event.type).slice(0, 13),
      [
        'PlayerJoined',
        'PlayerJoined',
        'PlayerJoined',
        'PlayerJoined',
        'PlayerReadyChanged',
        'PlayerReadyChanged',
        'PlayerReadyChanged',
        'PlayerReadyChanged',
        'GameStarted',
        'RoleAssigned',
        'RoleAssigned',
        'RoleAssigned',
        'RoleAssigned',
      ],
    );

    assert.deepEqual(
      events
        .filter((event) => event.type === 'RoleAssigned')
        .map((event) => (event.payload as { role: Role }).role)
        .sort(),
      ['CITIZEN', 'DOCTOR', 'MAFIA', 'POLICE'].sort(),
    );

    assert.ok(
      events.some((event) => event.type === 'MafiaTargetSelected'),
    );
    assert.ok(
      events.some((event) => event.type === 'DoctorTargetSelected'),
    );
    assert.ok(
      events.some((event) => event.type === 'PoliceInvestigated'),
    );

    const nightTransitionEvents = events.filter(
      (event) => event.requestId === 'req-e2e-next-night',
    );
    assert.deepEqual(
      nightTransitionEvents.map((event) => event.type),
      ['PhaseChanged', 'PlayerKilled'],
    );

    const dayTransitionEvents = events.filter(
      (event) => event.requestId === 'req-e2e-next-day',
    );
    assert.deepEqual(dayTransitionEvents.map((event) => event.type), [
      'PhaseChanged',
    ]);

    const votingTransitionEvents = events.filter(
      (event) => event.requestId === 'req-e2e-next-voting',
    );
    assert.deepEqual(
      votingTransitionEvents.map((event) => event.type),
      ['PhaseChanged', 'PlayerExecuted', 'GameFinished'],
    );

    const playerExecuted = votingTransitionEvents.find(
      (event) => event.type === 'PlayerExecuted',
    );
    assert.ok(playerExecuted);
    assert.equal(
      (playerExecuted?.payload as { targetUserId: string }).targetUserId,
      mafiaUserId,
    );

    const gameFinished = votingTransitionEvents.find(
      (event) => event.type === 'GameFinished',
    );
    assert.ok(gameFinished);
    assert.equal(
      (gameFinished?.payload as { winnerTeam: string }).winnerTeam,
      'CITIZEN',
    );

  } finally {
    await prisma.gameEventLog.deleteMany({
      where: { gameId: room.roomId },
    });
    host.socket.disconnect();
    guest1.socket.disconnect();
    guest2.socket.disconnect();
    guest3.socket.disconnect();
  }
});
