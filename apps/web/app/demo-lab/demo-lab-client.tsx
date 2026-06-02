"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type {
  AvailableAction,
  CommandAcceptedEvent,
  CommandEnvelope,
  CommandRejectedEvent,
  GameFinishedEvent,
  GameStartedEvent,
  PhaseChangedEvent,
  ReconnectStateEvent,
  Role,
  RoleAssignedEvent,
} from "@mafia-casefile/shared";
import { createDemoToken, createRoom, getApiBaseUrl } from "../../lib/api";
import { createSocket } from "../../lib/socket-client";
import {
  getTimelineEventLabel,
  parseTimelineResponse,
  sortTimelineEvents,
  type TimelineEvent,
} from "../../lib/timeline";

type DemoPlayerStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";
type ScenarioKind = "info" | "success" | "error";
type CommandResponse = CommandAcceptedEvent | CommandRejectedEvent;
type CommandWaiter = {
  resolve: (response: CommandResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DemoPlayer = {
  index: number;
  userId: string;
  email: string;
  nickname: string;
  token: string;
  socketStatus: DemoPlayerStatus;
  role: Role | "UNKNOWN";
  phase: string;
  isReady: boolean;
  alive: boolean;
  availableActions: AvailableAction[];
  lastEvent: string;
  serverInstanceId: string;
};

type RealtimeLogEntry = {
  id: string;
  receivedAt: string;
  playerId: string;
  playerName: string;
  eventName: string;
  payload: unknown;
};

type ScenarioLogEntry = {
  id: string;
  createdAt: string;
  kind: ScenarioKind;
  title: string;
  detail: string;
};

const PLAYER_NAMES = ["Host", "Detective", "Doctor", "Guest"];
const MAX_LOGS = 120;

export function DemoLabClient() {
  const [players, setPlayers] = useState<DemoPlayer[]>(() => buildInitialPlayers());
  const [roomId, setRoomId] = useState("");
  const [phase, setPhase] = useState("WAITING");
  const [turn, setTurn] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [scenarioLogs, setScenarioLogs] = useState<ScenarioLogEntry[]>([]);
  const [realtimeLogs, setRealtimeLogs] = useState<RealtimeLogEntry[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineError, setTimelineError] = useState("");

  const socketsRef = useRef(new Map<string, Socket>());
  const waitersRef = useRef(new Map<string, Map<string, CommandWaiter>>());

  useEffect(() => {
    return () => {
      for (const socket of socketsRef.current.values()) {
        socket.disconnect();
      }
      socketsRef.current.clear();
      for (const waiters of waitersRef.current.values()) {
        for (const waiter of waiters.values()) {
          clearTimeout(waiter.timer);
        }
      }
      waitersRef.current.clear();
    };
  }, []);

  const connectedCount = players.filter((player) => player.socketStatus === "connected").length;
  const roleSummary = players
    .map((player) => `${player.nickname}: ${displayRole(player.role)}`)
    .join(" / ");
  const deliverySummary = summarizeLastRoomDelivery(realtimeLogs, players);

  async function runStep(title: string, task: () => Promise<void>) {
    if (isBusy) {
      return;
    }

    setIsBusy(true);
    appendScenarioLog("info", title, "실행 중");
    try {
      await task();
      appendScenarioLog("success", title, "완료");
    } catch (error) {
      appendScenarioLog("error", title, getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreatePlayers() {
    await runStep("데모 플레이어 생성", async () => {
      const nextPlayers = buildInitialPlayers();
      const withTokens = await Promise.all(
        nextPlayers.map(async (player) => ({
          ...player,
          token: await createDemoToken({
            userId: player.userId,
            email: player.email,
          }),
        })),
      );
      disconnectAllSockets();
      setPlayers(withTokens);
      setRoomId("");
      setPhase("WAITING");
      setTurn(0);
      setTimelineEvents([]);
      setRealtimeLogs([]);
      appendScenarioLog(
        "success",
        "토큰 발급",
        `${withTokens.length}명의 로컬 데모 JWT를 발급했습니다.`,
      );
    });
  }

  async function handleConnectPlayers() {
    await runStep("4명 소켓 연결", async () => {
      const readyPlayers = await ensurePlayersHaveTokens(players);
      setPlayers(readyPlayers);

      for (const player of readyPlayers) {
        await connectPlayer(player);
      }
    });
  }

  async function handleBootstrapGame() {
    await runStep("방 생성부터 게임 시작까지", async () => {
      const readyPlayers = await ensureConnectedPlayers();
      const host = readyPlayers[0];
      const createdRoom = await createRoom({
        hostUserId: host.userId,
        name: `Demo Lab ${shortSuffix(4)}`,
      });
      setRoomId(createdRoom.roomId);
      appendScenarioLog("success", "방 생성", createdRoom.roomId);

      for (const player of readyPlayers) {
        await sendCommand(player.userId, {
          type: "JOIN_ROOM",
          gameId: createdRoom.roomId,
          payload: {
            nickname: player.nickname,
          },
        });
      }

      for (const player of readyPlayers) {
        await sendCommand(player.userId, {
          type: "CHANGE_READY",
          gameId: createdRoom.roomId,
          payload: {
            isReady: true,
          },
        });
        updatePlayer(player.userId, { isReady: true });
      }

      await sendCommand(host.userId, {
        type: "START_GAME",
        gameId: createdRoom.roomId,
        payload: {},
      });

      await refreshTimeline(createdRoom.roomId);
    });
  }

  async function handleRunNightActions() {
    await runStep("밤 액션 실행", async () => {
      const currentRoomId = requireRoomId();
      const mafia = findPlayerByRole("MAFIA");
      const doctor = findPlayerByRole("DOCTOR");
      const police = findPlayerByRole("POLICE");
      const citizenTarget = players.find(
        (player) => player.role !== "MAFIA" && player.alive,
      );
      const mafiaTarget = citizenTarget ?? players.find((player) => player.userId !== mafia?.userId);
      const doctorTarget = doctor ?? players[0];
      const policeTarget = mafia ?? players.find((player) => player.userId !== police?.userId);

      if (mafia && mafiaTarget) {
        await sendCommand(mafia.userId, {
          type: "SELECT_MAFIA_TARGET",
          gameId: currentRoomId,
          payload: { targetUserId: mafiaTarget.userId },
        });
      }

      if (doctor && doctorTarget) {
        await sendCommand(doctor.userId, {
          type: "SELECT_DOCTOR_TARGET",
          gameId: currentRoomId,
          payload: { targetUserId: doctorTarget.userId },
        });
      }

      if (police && policeTarget) {
        await sendCommand(police.userId, {
          type: "SELECT_POLICE_TARGET",
          gameId: currentRoomId,
          payload: { targetUserId: policeTarget.userId },
        });
      }

      await refreshTimeline(currentRoomId);
    });
  }

  async function handleAdvancePhase() {
    await runStep("phase 전환", async () => {
      const currentRoomId = requireRoomId();
      await sendCommand(players[0].userId, {
        type: "NEXT_PHASE",
        gameId: currentRoomId,
        payload: {},
      });
      await delay(350);
      await refreshTimeline(currentRoomId);
    });
  }

  async function handleRunVotes() {
    await runStep("투표 실행", async () => {
      const currentRoomId = requireRoomId();
      const target = findPlayerByRole("MAFIA") ?? players.find((player) => player.alive);

      if (!target) {
        throw new Error("투표 대상이 없습니다.");
      }

      for (const player of players.filter((candidate) => candidate.alive)) {
        await sendCommand(player.userId, {
          type: "CAST_VOTE",
          gameId: currentRoomId,
          payload: {
            targetUserId: target.userId,
          },
        });
      }

      await refreshTimeline(currentRoomId);
    });
  }

  async function handleDuplicateVote() {
    await runStep("중복 requestId 투표", async () => {
      const currentRoomId = requireRoomId();
      const voter = players.find((player) => player.alive) ?? players[0];
      const target =
        players.find((player) => player.userId !== voter.userId && player.alive) ?? players[1];
      const requestId = createRequestId("duplicate-vote");
      const command = {
        type: "CAST_VOTE",
        requestId,
        gameId: currentRoomId,
        payload: {
          targetUserId: target.userId,
        },
      } satisfies CommandEnvelope;

      const first = await sendRawCommand(voter.userId, command);
      const second = await sendRawCommand(voter.userId, command);
      appendScenarioLog(
        second.type === "COMMAND_ACCEPTED" ? "success" : "error",
        "중복 requestId 결과",
        `first=${first.type}, second=${second.type}, requestId=${requestId}`,
      );
      await refreshTimeline(currentRoomId);
    });
  }

  async function handleInvalidMafiaChat() {
    await runStep("권한 없는 마피아 채팅", async () => {
      const currentRoomId = requireRoomId();
      const nonMafia = players.find((player) => player.role !== "MAFIA") ?? players[1];
      await sendCommand(nonMafia.userId, {
        type: "SEND_CHAT_MESSAGE",
        gameId: currentRoomId,
        payload: {
          channel: "MAFIA",
          message: "권한 없는 마피아 채팅 시도",
        },
      });
    });
  }

  async function handleReconnectPlayer() {
    await runStep("플레이어 재접속", async () => {
      const target = players[1] ?? players[0];
      const socket = socketsRef.current.get(target.userId);
      socket?.disconnect();
      updatePlayer(target.userId, {
        socketStatus: "disconnected",
        lastEvent: "manual disconnect",
      });
      await delay(500);
      await connectPlayer(target);
    });
  }

  async function handleRefreshTimeline() {
    await runStep("timeline 새로고침", async () => {
      await refreshTimeline(requireRoomId());
    });
  }

  function handleReset() {
    disconnectAllSockets();
    setPlayers(buildInitialPlayers());
    setRoomId("");
    setPhase("WAITING");
    setTurn(0);
    setScenarioLogs([]);
    setRealtimeLogs([]);
    setTimelineEvents([]);
    setTimelineError("");
  }

  async function ensurePlayersHaveTokens(currentPlayers: DemoPlayer[]) {
    if (currentPlayers.every((player) => player.token)) {
      return currentPlayers;
    }

    const withTokens = await Promise.all(
      currentPlayers.map(async (player) => ({
        ...player,
        token:
          player.token ||
          (await createDemoToken({
            userId: player.userId,
            email: player.email,
          })),
      })),
    );
    return withTokens;
  }

  async function ensureConnectedPlayers() {
    const withTokens = await ensurePlayersHaveTokens(players);
    setPlayers(withTokens);

    for (const player of withTokens) {
      if (!socketsRef.current.get(player.userId)?.connected) {
        await connectPlayer(player);
      }
    }

    return withTokens;
  }

  async function connectPlayer(player: DemoPlayer) {
    if (!player.token) {
      throw new Error(`${player.nickname} 토큰이 없습니다.`);
    }

    const existing = socketsRef.current.get(player.userId);
    if (existing?.connected) {
      return;
    }

    existing?.disconnect();
    updatePlayer(player.userId, {
      socketStatus: "connecting",
      lastEvent: "connecting",
    });

    const socket = createSocket(player.token);
    socketsRef.current.set(player.userId, socket);
    waitersRef.current.set(player.userId, new Map());
    registerSocketHandlers(player, socket);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${player.nickname} 소켓 연결 시간이 초과되었습니다.`));
      }, 5000);

      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.connect();
    });
  }

  function registerSocketHandlers(player: DemoPlayer, socket: Socket) {
    const logEvent = (eventName: string, payload: unknown) => {
      appendRealtimeLog(player, eventName, payload);
      updatePlayer(player.userId, { lastEvent: eventName });
    };

    socket.on("connect", () => {
      updatePlayer(player.userId, {
        socketStatus: "connected",
        lastEvent: "connect",
      });
      appendRealtimeLog(player, "connect", {
        socketId: socket.id,
      });
    });

    socket.on("disconnect", (reason) => {
      updatePlayer(player.userId, {
        socketStatus: "disconnected",
        lastEvent: "disconnect",
      });
      appendRealtimeLog(player, "disconnect", { reason });
    });

    socket.on("connect_error", (error) => {
      updatePlayer(player.userId, {
        socketStatus: "error",
        lastEvent: "connect_error",
      });
      appendRealtimeLog(player, "connect_error", {
        message: error.message,
      });
    });

    socket.on("room:updated", (payload: unknown) => {
      logEvent("room:updated", payload);
      updateReadyStateFromRoom(payload);
    });
    socket.on("game:started", (event: GameStartedEvent) => {
      logEvent("game:started", event);
      setPhase("NIGHT");
      setTurn(0);
      updatePlayer(player.userId, { phase: "NIGHT" });
    });
    socket.on("role:assigned", (event: RoleAssignedEvent) => {
      logEvent("role:assigned", event);
      updatePlayer(event.userId, {
        role: event.role,
      });
    });
    socket.on("phase:changed", (event: PhaseChangedEvent) => {
      logEvent("phase:changed", event);
      setPhase(event.toPhase);
      setTurn(event.turn);
      setPlayers((current) =>
        current.map((candidate) => ({
          ...candidate,
          phase: event.toPhase,
        })),
      );
    });
    socket.on("game:finished", (event: GameFinishedEvent) => {
      logEvent("game:finished", event);
      setPhase("FINISHED");
    });
    socket.on("reconnect:state", (event: ReconnectStateEvent) => {
      logEvent("reconnect:state", event);
      const reconnectPlayer = parseReconnectPlayer(event.player);
      const reconnectSession = parseReconnectSession(event.session);
      updatePlayer(player.userId, {
        role: reconnectPlayer?.role ?? player.role,
        alive: reconnectPlayer?.status ? reconnectPlayer.status !== "DEAD" : player.alive,
        phase: reconnectSession?.phase ?? player.phase,
        availableActions: event.availableActions ?? [],
        serverInstanceId: extractServerInstanceId(event) ?? player.serverInstanceId,
      });
      if (reconnectSession?.phase) {
        setPhase(reconnectSession.phase);
      }
      if (typeof reconnectSession?.turn === "number") {
        setTurn(reconnectSession.turn);
      }
    });
    socket.on("night:resolved", (payload: unknown) => {
      logEvent("night:resolved", payload);
      updateDeadPlayerFromPayload(payload, "killedUserId");
    });
    socket.on("voting:resolved", (payload: unknown) => {
      logEvent("voting:resolved", payload);
      updateDeadPlayerFromPayload(payload, "executedUserId");
    });
    socket.on("investigation:result", (payload: unknown) => logEvent("investigation:result", payload));
    socket.on("player:disconnected", (payload: unknown) => logEvent("player:disconnected", payload));
    socket.on("chat:message", (payload: unknown) => logEvent("chat:message", payload));

    socket.on("command:accepted", (event: CommandAcceptedEvent) => {
      logEvent("command:accepted", event);
      resolveCommand(player.userId, event);
    });
    socket.on("command:rejected", (event: CommandRejectedEvent) => {
      logEvent("command:rejected", event);
      resolveCommand(player.userId, event);
    });
  }

  async function sendCommand(
    userId: string,
    input: {
      type: string;
      gameId: string;
      payload: Record<string, unknown>;
    },
  ) {
    const command = {
      type: input.type,
      requestId: createRequestId(input.type.toLowerCase()),
      gameId: input.gameId,
      payload: input.payload,
    } satisfies CommandEnvelope;

    return sendRawCommand(userId, command);
  }

  async function sendRawCommand(userId: string, command: CommandEnvelope) {
    const socket = socketsRef.current.get(userId);
    const player = players.find((candidate) => candidate.userId === userId);

    if (!socket?.connected) {
      throw new Error(`${player?.nickname ?? userId} 소켓이 연결되지 않았습니다.`);
    }

    appendScenarioLog("info", command.type, `${player?.nickname ?? userId} -> ${command.requestId}`);

    const responsePromise = new Promise<CommandResponse>((resolve) => {
      const timer = setTimeout(() => {
        const waiters = waitersRef.current.get(userId);
        waiters?.delete(command.requestId);
        resolve({
          type: "COMMAND_REJECTED",
          requestId: command.requestId,
          reason: "ROOM_COMMAND_FAILED",
          message: "command response timed out",
        });
      }, 5000);

      const waiters = waitersRef.current.get(userId) ?? new Map<string, CommandWaiter>();
      waiters.set(command.requestId, { resolve, timer });
      waitersRef.current.set(userId, waiters);
    });

    socket.emit("command", command);
    const response = await responsePromise;
    appendScenarioLog(
      response.type === "COMMAND_ACCEPTED" ? "success" : "error",
      response.type,
      response.type === "COMMAND_ACCEPTED"
        ? `${response.receivedType} · ${response.requestId}`
        : `${response.reason} · ${response.message}`,
    );
    return response;
  }

  function resolveCommand(userId: string, response: CommandResponse) {
    if (!response.requestId) {
      return;
    }

    const waiters = waitersRef.current.get(userId);
    const waiter = waiters?.get(response.requestId);
    if (!waiter) {
      return;
    }

    clearTimeout(waiter.timer);
    waiters?.delete(response.requestId);
    waiter.resolve(response);
  }

  async function refreshTimeline(targetRoomId: string) {
    setTimelineError("");
    const response = await fetch(
      `${getApiBaseUrl()}/games/${encodeURIComponent(targetRoomId)}/timeline`,
      { cache: "no-store" },
    );
    const data = await response.json();

    if (!response.ok) {
      const message =
        isRecord(data) && typeof data.message === "string"
          ? data.message
          : "timeline 조회에 실패했습니다.";
      setTimelineError(message);
      throw new Error(message);
    }

    const parsed = parseTimelineResponse(data);
    if (!parsed) {
      throw new Error("timeline 응답 형식이 올바르지 않습니다.");
    }

    setTimelineEvents(sortTimelineEvents(parsed.events));
  }

  function appendScenarioLog(kind: ScenarioKind, title: string, detail: string) {
    setScenarioLogs((current) =>
      [
        {
          id: createRequestId("scenario"),
          createdAt: new Date().toISOString(),
          kind,
          title,
          detail,
        },
        ...current,
      ].slice(0, MAX_LOGS),
    );
  }

  function appendRealtimeLog(player: DemoPlayer, eventName: string, payload: unknown) {
    setRealtimeLogs((current) =>
      [
        {
          id: createRequestId("event"),
          receivedAt: new Date().toISOString(),
          playerId: player.userId,
          playerName: player.nickname,
          eventName,
          payload,
        },
        ...current,
      ].slice(0, MAX_LOGS),
    );
  }

  function updatePlayer(userId: string, patch: Partial<DemoPlayer>) {
    setPlayers((current) =>
      current.map((player) => (player.userId === userId ? { ...player, ...patch } : player)),
    );
  }

  function updateReadyStateFromRoom(payload: unknown) {
    if (!isRecord(payload) || !isRecord(payload.room) || !Array.isArray(payload.room.participants)) {
      return;
    }

    const participants = payload.room.participants.filter(isRecord);
    setPlayers((current) =>
      current.map((player) => {
        const participant = participants.find(
          (entry) => entry.userId === player.userId && typeof entry.isReady === "boolean",
        );
        return participant ? { ...player, isReady: Boolean(participant.isReady) } : player;
      }),
    );
  }

  function updateDeadPlayerFromPayload(payload: unknown, key: "killedUserId" | "executedUserId") {
    if (!isRecord(payload) || typeof payload[key] !== "string") {
      return;
    }

    updatePlayer(payload[key], { alive: false });
  }

  function disconnectAllSockets() {
    for (const socket of socketsRef.current.values()) {
      socket.disconnect();
    }
    socketsRef.current.clear();
    for (const waiters of waitersRef.current.values()) {
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
      }
    }
    waitersRef.current.clear();
  }

  function requireRoomId() {
    if (!roomId.trim()) {
      throw new Error("먼저 방을 생성하고 게임을 시작하세요.");
    }

    return roomId;
  }

  function findPlayerByRole(role: Role) {
    return players.find((player) => player.role === role && player.alive);
  }

  const timelineSummary = useMemo(() => {
    const voteEvents = timelineEvents.filter((event) => event.type === "VoteCasted").length;
    return {
      total: timelineEvents.length,
      votes: voteEvents,
      lastSeq: timelineEvents.at(-1)?.seq ?? 0,
    };
  }, [timelineEvents]);

  return (
    <main className="page demo-lab-page">
      <header className="demo-lab-hero">
        <div>
          <p className="eyebrow">Demo Lab</p>
          <h1>한 사람이 관찰하는 4인 게임 서버 흐름</h1>
          <p className="hero-copy">
            4명의 데모 플레이어를 실제 Socket.IO command로 제어하고, 실시간 이벤트와
            PostgreSQL 사건 타임라인을 함께 확인합니다.
          </p>
        </div>
        <div className="demo-lab-hero__actions">
          <Link className="button button--secondary" href="/">
            홈
          </Link>
          <Link className="button button--secondary" href="/play">
            일반 플레이
          </Link>
        </div>
      </header>

      <section className="demo-lab-status-grid" aria-label="백엔드 관찰 요약">
        <StatusCard label="socket 연결" value={`${connectedCount}/4`} note={getApiBaseUrl()} />
        <StatusCard label="room" value={roomId || "미생성"} note={`phase ${phase} · turn ${turn}`} />
        <StatusCard label="역할" value={roleSummary} note="role:assigned event 기준" />
        <StatusCard
          label="timeline"
          value={`${timelineSummary.total} events`}
          note={`last seq ${timelineSummary.lastSeq} · votes ${timelineSummary.votes}`}
        />
        <StatusCard
          label="room delivery"
          value={deliverySummary.value}
          note={deliverySummary.note}
        />
      </section>

      <section className="demo-lab-layout">
        <aside className="demo-lab-panel demo-lab-controls">
          <div>
            <p className="section-kicker">Scenario Control</p>
            <h2>실행 단계</h2>
          </div>
          <button className="button button--primary" disabled={isBusy} onClick={handleCreatePlayers}>
            데모 플레이어 생성
          </button>
          <button className="button" disabled={isBusy} onClick={handleConnectPlayers}>
            4명 소켓 연결
          </button>
          <button className="button" disabled={isBusy} onClick={handleBootstrapGame}>
            방 생성 · 참가 · Ready · 시작
          </button>
          <button className="button" disabled={isBusy} onClick={handleRunNightActions}>
            밤 액션 실행
          </button>
          <button className="button" disabled={isBusy} onClick={handleAdvancePhase}>
            phase 전환
          </button>
          <button className="button" disabled={isBusy} onClick={handleRunVotes}>
            투표 실행
          </button>
          <button className="button" disabled={isBusy} onClick={handleDuplicateVote}>
            중복 requestId 투표
          </button>
          <button className="button" disabled={isBusy} onClick={handleInvalidMafiaChat}>
            권한 없는 마피아 채팅
          </button>
          <button className="button" disabled={isBusy} onClick={handleReconnectPlayer}>
            플레이어 재접속
          </button>
          <button className="button" disabled={isBusy} onClick={handleRefreshTimeline}>
            timeline 새로고침
          </button>
          <button className="button button--secondary" disabled={isBusy} onClick={handleReset}>
            데모 상태 초기화
          </button>
        </aside>

        <section className="demo-lab-main">
          <div className="demo-lab-player-grid">
            {players.map((player) => (
              <article className="demo-player-card" key={player.userId}>
                <div className="demo-player-card__header">
                  <div>
                    <strong>{player.nickname}</strong>
                    <span>{player.userId}</span>
                  </div>
                  <span className={`status-pill status-pill--${player.socketStatus}`}>
                    {displaySocketStatus(player.socketStatus)}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>role</dt>
                    <dd>{displayRole(player.role)}</dd>
                  </div>
                  <div>
                    <dt>phase</dt>
                    <dd>{player.phase}</dd>
                  </div>
                  <div>
                    <dt>ready</dt>
                    <dd>{player.isReady ? "YES" : "NO"}</dd>
                  </div>
                  <div>
                    <dt>alive</dt>
                    <dd>{player.alive ? "ALIVE" : "DEAD"}</dd>
                  </div>
                  <div>
                    <dt>instance</dt>
                    <dd>{player.serverInstanceId}</dd>
                  </div>
                  <div>
                    <dt>actions</dt>
                    <dd>{player.availableActions.map((action) => action.type).join(", ") || "-"}</dd>
                  </div>
                </dl>
                <p className="event-preview">last: {player.lastEvent || "-"}</p>
              </article>
            ))}
          </div>

          <div className="demo-lab-observer-grid">
            <LogPanel title="Scenario Result" logs={scenarioLogs} />
            <RealtimePanel logs={realtimeLogs} />
            <TimelinePanel events={timelineEvents} error={timelineError} />
          </div>
        </section>
      </section>
    </main>
  );
}

function StatusCard({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <article className="demo-status-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function LogPanel({ logs, title }: { logs: ScenarioLogEntry[]; title: string }) {
  return (
    <section className="demo-lab-panel">
      <div className="panel-heading">
        <p className="section-kicker">Scenario</p>
        <h2>{title}</h2>
      </div>
      <div className="demo-log-list">
        {logs.length === 0 ? <p className="connection-empty">시나리오 실행 결과가 여기에 쌓입니다.</p> : null}
        {logs.map((log) => (
          <article className={`demo-log-entry demo-log-entry--${log.kind}`} key={log.id}>
            <span>{formatTime(log.createdAt)}</span>
            <strong>{log.title}</strong>
            <p>{log.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RealtimePanel({ logs }: { logs: RealtimeLogEntry[] }) {
  return (
    <section className="demo-lab-panel">
      <div className="panel-heading">
        <p className="section-kicker">Socket.IO</p>
        <h2>Realtime Event Log</h2>
      </div>
      <div className="demo-log-list">
        {logs.length === 0 ? <p className="connection-empty">플레이어별 수신 이벤트가 표시됩니다.</p> : null}
        {logs.map((log) => (
          <article className="demo-log-entry" key={log.id}>
            <span>
              {formatTime(log.receivedAt)} · {log.playerName}
            </span>
            <strong>{log.eventName}</strong>
            <pre>{formatPayload(log.payload)}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}

function TimelinePanel({ error, events }: { error: string; events: TimelineEvent[] }) {
  return (
    <section className="demo-lab-panel demo-lab-panel--wide">
      <div className="panel-heading">
        <p className="section-kicker">PostgreSQL</p>
        <h2>Persistent Timeline</h2>
      </div>
      {error ? <p className="play-alert">{error}</p> : null}
      <div className="demo-timeline-table">
        <div className="demo-timeline-row demo-timeline-row--head">
          <span>seq</span>
          <span>type</span>
          <span>phase</span>
          <span>actor</span>
          <span>requestId</span>
        </div>
        {events.length === 0 ? (
          <p className="connection-empty">timeline API 응답이 여기에 표시됩니다.</p>
        ) : null}
        {events.map((event) => (
          <div className="demo-timeline-row" key={event.id}>
            <span>{event.seq}</span>
            <strong>{getTimelineEventLabel(event.type)}</strong>
            <span>{event.phase}</span>
            <span>{event.actorUserId ?? "-"}</span>
            <span>{event.requestId ?? "-"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildInitialPlayers(): DemoPlayer[] {
  const runId = shortSuffix(5);
  return PLAYER_NAMES.map((name, index) => {
    const userId = `demo-lab-${runId}-${index + 1}`;
    return {
      index,
      userId,
      email: `${userId}@example.com`,
      nickname: name,
      token: "",
      socketStatus: "idle",
      role: "UNKNOWN",
      phase: "WAITING",
      isReady: false,
      alive: true,
      availableActions: [],
      lastEvent: "",
      serverInstanceId: "미노출",
    };
  });
}

function parseReconnectPlayer(value: unknown): {
  role?: Role;
  status?: string;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    role: typeof value.role === "string" ? (value.role as Role) : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
  };
}

function parseReconnectSession(value: unknown): { phase?: string; turn?: number } | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    phase: typeof value.phase === "string" ? value.phase : undefined,
    turn: typeof value.turn === "number" ? value.turn : undefined,
  };
}

function extractServerInstanceId(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return typeof value.serverInstanceId === "string" ? value.serverInstanceId : null;
}

function summarizeLastRoomDelivery(logs: RealtimeLogEntry[], players: DemoPlayer[]) {
  const roomEvent = logs.find((log) =>
    ["room:updated", "phase:changed", "chat:message", "game:started"].includes(log.eventName),
  );

  if (!roomEvent) {
    return {
      value: "대기 중",
      note: "room event 수신 후 갱신",
    };
  }

  const receivers = new Set(
    logs
      .filter((log) => log.eventName === roomEvent.eventName)
      .slice(0, players.length)
      .map((log) => log.playerId),
  );

  return {
    value: `${receivers.size}/${players.length}`,
    note: `${roomEvent.eventName} delivery`,
  };
}

function displaySocketStatus(status: DemoPlayerStatus) {
  switch (status) {
    case "connected":
      return "연결";
    case "connecting":
      return "연결 중";
    case "disconnected":
      return "해제";
    case "error":
      return "오류";
    default:
      return "대기";
  }
}

function displayRole(role: string) {
  switch (role) {
    case "MAFIA":
      return "마피아";
    case "CITIZEN":
      return "시민";
    case "DOCTOR":
      return "의사";
    case "POLICE":
      return "경찰";
    default:
      return "미정";
  }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2).slice(0, 700);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function createRequestId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? shortSuffix(10)}`;
}

function shortSuffix(length = 6) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
