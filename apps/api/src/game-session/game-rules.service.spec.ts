import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { InMemoryGameSessionRepository } from './in-memory-game-session.repository';
import { GameSessionService, type StartGameSessionInput } from './game-session.service';
import type { GameSession } from './game-session';

function createPlayers() {
  return [
    {
      userId: 'user-1',
      nickname: 'alpha',
      role: 'MAFIA' as const,
    },
    {
      userId: 'user-2',
      nickname: 'bravo',
      role: 'DOCTOR' as const,
    },
    {
      userId: 'user-3',
      nickname: 'charlie',
      role: 'POLICE' as const,
    },
    {
      userId: 'user-4',
      nickname: 'delta',
      role: 'CITIZEN' as const,
    },
  ];
}

function createStartInput(gameId: string): StartGameSessionInput {
  return {
    gameId,
    roomId: gameId,
    hostUserId: 'user-1',
    players: createPlayers(),
    startedAt: new Date('2026-05-16T12:00:00.000Z'),
  };
}

function createService() {
  const repository = new InMemoryGameSessionRepository();
  const service = new GameSessionService(repository);

  return { repository, service };
}

async function seedSession(service: GameSessionService, gameId: string) {
  return await service.startGameSession(createStartInput(gameId));
}

async function saveSession(
  repository: InMemoryGameSessionRepository,
  session: GameSession,
) {
  return await repository.save(session);
}

test('phase transition rules', async () => {
  const { service } = createService();
  const gameId = randomUUID();

  const started = await seedSession(service, gameId);
  assert.equal(started.phase, 'NIGHT');
  assert.equal(started.turn, 0);

  const day = await service.advancePhase(gameId);
  assert.equal(day.fromPhase, 'NIGHT');
  assert.equal(day.toPhase, 'DAY_DISCUSSION');
  assert.equal(day.toTurn, 1);

  const voting = await service.advancePhase(gameId);
  assert.equal(voting.fromPhase, 'DAY_DISCUSSION');
  assert.equal(voting.toPhase, 'VOTING');
  assert.equal(voting.toTurn, 1);

  const night = await service.advancePhase(gameId);
  assert.equal(night.fromPhase, 'VOTING');
  assert.equal(night.toPhase, 'RESULT');
  assert.equal(night.toTurn, 1);

  const nextNight = await service.advancePhase(gameId);
  assert.equal(nextNight.fromPhase, 'RESULT');
  assert.equal(nextNight.toPhase, 'NIGHT');
  assert.equal(nextNight.toTurn, 1);

  const finished = await service.finishGame(gameId);
  assert.equal(finished.toPhase, 'FINISHED');

  await assert.rejects(() => service.advancePhase(gameId), /game is finished/);
});

test('night action phase rules', async () => {
  const { service } = createService();
  const gameId = randomUUID();
  await seedSession(service, gameId);

  const mafiaTarget = await service.selectMafiaTarget(
    gameId,
    'user-1',
    'user-4',
  );
  assert.equal(mafiaTarget.actor.userId, 'user-1');

  const doctorTarget = await service.selectDoctorTarget(
    gameId,
    'user-2',
    'user-1',
  );
  assert.equal(doctorTarget.target.userId, 'user-1');

  const policeTarget = await service.selectPoliceTarget(
    gameId,
    'user-3',
    'user-1',
  );
  assert.equal(policeTarget.target.userId, 'user-1');

  const daySession = await service.advancePhase(gameId);
  assert.equal(daySession.toPhase, 'DAY_DISCUSSION');

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-1', 'user-4'),
    /night actions are only allowed during NIGHT/,
  );

  const votingSession = await service.advancePhase(gameId);
  assert.equal(votingSession.toPhase, 'VOTING');

  await assert.rejects(
    () => service.selectDoctorTarget(gameId, 'user-2', 'user-1'),
    /night actions are only allowed during NIGHT/,
  );
});

test('night action은 역할별로 한 번만 선택할 수 있고 의사는 자기 자신을 보호할 수 있다', async () => {
  const { service } = createService();
  const gameId = randomUUID();
  await seedSession(service, gameId);

  const doctorSelfTarget = await service.selectDoctorTarget(
    gameId,
    'user-2',
    'user-2',
  );
  assert.equal(doctorSelfTarget.target.userId, 'user-2');

  await assert.rejects(
    () => service.selectDoctorTarget(gameId, 'user-2', 'user-1'),
    /night action already selected/,
  );

  const mafiaTarget = await service.selectMafiaTarget(
    gameId,
    'user-1',
    'user-4',
  );
  assert.equal(mafiaTarget.target.userId, 'user-4');

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-1', 'user-3'),
    /night action already selected/,
  );

  const policeTarget = await service.selectPoliceTarget(
    gameId,
    'user-3',
    'user-1',
  );
  assert.equal(policeTarget.target.userId, 'user-1');

  await assert.rejects(
    () => service.selectPoliceTarget(gameId, 'user-3', 'user-4'),
    /night action already selected/,
  );
});

test('night action role rules', async () => {
  const { service, repository } = createService();
  const gameId = randomUUID();
  await seedSession(service, gameId);

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-4', 'user-1'),
    /role not allowed/,
  );
  await assert.rejects(
    () => service.selectDoctorTarget(gameId, 'user-1', 'user-2'),
    /role not allowed/,
  );
  await assert.rejects(
    () => service.selectPoliceTarget(gameId, 'user-1', 'user-3'),
    /role not allowed/,
  );
  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-2', 'user-1'),
    /role not allowed/,
  );
  await assert.rejects(
    () => service.selectPoliceTarget(gameId, 'user-2', 'user-1'),
    /role not allowed/,
  );
  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-3', 'user-1'),
    /role not allowed/,
  );
  await assert.rejects(
    () => service.selectDoctorTarget(gameId, 'user-3', 'user-1'),
    /role not allowed/,
  );

  const deadCitizen = await service.findByGameId(gameId);
  assert.ok(deadCitizen);

  await saveSession(repository, {
    ...deadCitizen,
    players: deadCitizen.players.map((player) =>
      player.userId === 'user-1'
        ? {
            ...player,
            status: 'DEAD' as const,
          }
        : player,
    ),
  });

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-1', 'user-2'),
    /dead player cannot act/,
  );

  await saveSession(repository, {
    ...deadCitizen,
    players: deadCitizen.players.map((player) =>
      player.userId === 'user-4'
        ? {
            ...player,
            status: 'DEAD' as const,
          }
        : player,
    ),
  });

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-1', 'user-4'),
    /target player is not alive/,
  );

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'user-1', 'user-1'),
    /target self is not allowed/,
  );

  await assert.rejects(
    () => service.selectPoliceTarget(gameId, 'user-3', 'user-3'),
    /target self is not allowed/,
  );

  await assert.rejects(
    () => service.selectMafiaTarget(gameId, 'missing-actor', 'user-2'),
    /actor not found/,
  );

  await assert.rejects(
    () => service.selectDoctorTarget(gameId, 'user-2', 'missing-target'),
    /target player not found/,
  );

  await saveSession(repository, {
    ...deadCitizen,
    players: deadCitizen.players.map((player) =>
      player.userId === 'user-1'
        ? {
            ...player,
            status: 'ALIVE' as const,
          }
        : player,
    ),
  });
});

test('alive/dead voting rules', async () => {
  const { service, repository } = createService();
  const gameId = randomUUID();
  await seedSession(service, gameId);
  await service.advancePhase(gameId);

  await assert.rejects(
    () => service.castVote(gameId, 'user-2', 'user-1', 'req-vote-day-1'),
    /votes are only allowed during VOTING/,
  );

  await service.advancePhase(gameId);

  const votingSession = await service.findByGameId(gameId);
  assert.ok(votingSession);

  const vote = await service.castVote(gameId, 'user-2', 'user-1', 'req-vote-1');
  assert.equal(vote.duplicateRequest, false);

  await assert.rejects(
    () => service.castVote(gameId, 'user-2', 'user-1', 'req-vote-2'),
    /vote already cast/,
  );

  const duplicateVote = await service.castVote(
    gameId,
    'user-2',
    'user-4',
    'req-vote-1',
  );
  assert.equal(duplicateVote.duplicateRequest, true);
  assert.equal(duplicateVote.session.votes['user-2'], 'user-1');

  await saveSession(repository, {
    ...votingSession,
    players: votingSession.players.map((player) =>
      player.userId === 'user-3'
        ? {
            ...player,
            status: 'DEAD' as const,
          }
        : player,
    ),
  });

  await assert.rejects(
    () => service.castVote(gameId, 'user-3', 'user-1', 'req-vote-3'),
    /dead player cannot vote/,
  );

  await assert.rejects(
    () => service.castVote(gameId, 'user-2', 'missing-target', 'req-vote-4'),
    /target player not found/,
  );

  await assert.rejects(
    () => service.castVote(gameId, 'missing-actor', 'user-1', 'req-vote-5'),
    /actor not found/,
  );

  await assert.rejects(
    () => service.castVote(gameId, 'user-2', 'user-3', 'req-vote-6'),
    /target player is not alive/,
  );
});

test('night outcome rules', async () => {
  const { service, repository } = createService();
  const gameId = randomUUID();
  await seedSession(service, gameId);

  await saveSession(repository, {
    ...(await service.findByGameId(gameId))!,
    nightActions: {
      mafiaTarget: 'user-4',
      doctorTarget: 'user-4',
      policeTarget: 'user-3',
    },
  });

  const protectedOutcome = await service.resolveNightOutcome(gameId);
  assert.equal(protectedOutcome.killed, null);
  assert.equal(protectedOutcome.protectedTarget?.userId, 'user-4');
  assert.equal(
    protectedOutcome.session.nightActions.mafiaTarget,
    undefined,
  );

  const currentNightSession = await service.findByGameId(gameId);
  assert.ok(currentNightSession);

  await saveSession(repository, {
    ...currentNightSession,
    players: currentNightSession.players.map((player) =>
      player.userId === 'user-4'
        ? {
            ...player,
            status: 'ALIVE' as const,
          }
        : player,
    ),
    nightActions: {
      mafiaTarget: 'user-4',
      doctorTarget: 'user-2',
      policeTarget: 'user-3',
    },
  });

  const killOutcome = await service.resolveNightOutcome(gameId);
  assert.equal(killOutcome.killed?.userId, 'user-4');
  assert.equal(
    killOutcome.session.players.find((player) => player.userId === 'user-4')
      ?.status,
    'DEAD',
  );
  assert.deepEqual(killOutcome.session.nightActions, {});
});

test('voting outcome rules', async () => {
  const { service, repository } = createService();
  const gameId = randomUUID();
  await seedSession(service, gameId);
  await service.advancePhase(gameId);
  await service.advancePhase(gameId);

  const votingSession = await service.findByGameId(gameId);
  assert.ok(votingSession);

  await saveSession(repository, {
    ...votingSession,
    votes: {
      'user-2': 'user-1',
      'user-3': 'user-1',
      'user-4': 'user-1',
    },
  });

  const executedOutcome = await service.resolveVotingOutcome(gameId);
  assert.equal(executedOutcome.executed?.userId, 'user-1');
  assert.equal(
    executedOutcome.session.players.find((player) => player.userId === 'user-1')
      ?.status,
    'DEAD',
  );
  assert.deepEqual(executedOutcome.session.votes, {});
  assert.equal(executedOutcome.winnerTeam, 'CITIZEN');

  await saveSession(repository, {
    ...executedOutcome.session,
    phase: 'VOTING',
    votes: {
      'user-2': 'user-4',
      'user-3': 'user-1',
    },
    players: executedOutcome.session.players.map((player) =>
      player.userId === 'user-1'
        ? {
            ...player,
            status: 'ALIVE' as const,
          }
        : player,
    ),
  });

  const tiedOutcome = await service.resolveVotingOutcome(gameId);
  assert.equal(tiedOutcome.executed, null);
  assert.deepEqual(tiedOutcome.session.votes, {});

  await saveSession(repository, {
    ...tiedOutcome.session,
    phase: 'VOTING',
    votes: {},
    players: tiedOutcome.session.players.map((player) =>
      player.userId === 'user-1'
        ? {
            ...player,
            status: 'ALIVE' as const,
          }
        : {
            ...player,
            status: 'DEAD' as const,
          },
    ),
  });

  const mafiaWinOutcome = await service.resolveVotingOutcome(gameId);
  assert.equal(mafiaWinOutcome.winnerTeam, 'MAFIA');
});
