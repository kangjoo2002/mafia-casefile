"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessageEvent,
  CommandAcceptedEvent,
  CommandRejectedEvent,
  GameStartedEvent,
  PhaseChangedEvent,
  PlayerDisconnectedEvent,
  ReconnectStateEvent,
  RoleAssignedEvent,
  AvailableAction,
} from "@mafia-casefile/shared";
import {
  createDemoToken,
  createRoom,
  getRoom,
} from "../../lib/api";
import type {
  ChatMessageView,
  DemoIdentity,
  EventLogEntry,
  GameSessionPlayerView,
  GameSessionView,
  RoomView,
} from "../../lib/play-types";
import { createSocket } from "../../lib/socket-client";
import type { Socket } from "socket.io-client";

type CommandEnvelope = {
  type:
    | "JOIN_ROOM"
    | "CHANGE_READY"
    | "START_GAME"
    | "NEXT_PHASE"
    | "CAST_VOTE"
    | "SELECT_MAFIA_TARGET"
    | "SELECT_DOCTOR_TARGET"
    | "SELECT_POLICE_TARGET"
    | "SEND_CHAT_MESSAGE";
  requestId: string;
  gameId: string;
  payload: Record<string, unknown>;
};

type CommandResponse = CommandAcceptedEvent | CommandRejectedEvent;

type SocketStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

const STORAGE_KEYS = {
  demoUser: "mafia-casefile.demoUser",
  demoToken: "mafia-casefile.demoToken",
  lastRoomId: "mafia-casefile.lastRoomId",
} as const;

const DEFAULT_CHAT_CHANNELS = ["LOBBY", "DAY", "MAFIA", "GHOST"] as const;

export function PlayClient() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const commandWaiters = useRef(
    new Map<
      string,
      {
        resolve: (response: CommandResponse) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const knownChatKeys = useRef(new Set<string>());
  const hydratedRef = useRef(false);

  const [identity, setIdentity] = useState<DemoIdentity>(() => ({
    userId: "demo-user",
    email: "demo-user@example.com",
    nickname: "demo-user",
    token: "",
  }));
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomNameInput, setRoomNameInput] = useState("데모 방");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<GameSessionView | null>(null);
  const [myRole, setMyRole] = useState<string>("");
  const [myStatus, setMyStatus] = useState<string>("");
  const [myConnectionStatus, setMyConnectionStatus] = useState<string>("CONNECTED");
  const [serverAvailableActions, setServerAvailableActions] = useState<AvailableAction[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageView[]>([]);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("idle");
  const [socketId, setSocketId] = useState<string>("");
  const [connectionError, setConnectionError] = useState("");
  const [reconnectReason, setReconnectReason] = useState("");
  const [restored, setRestored] = useState(false);
  const [chatChannel, setChatChannel] = useState<"LOBBY" | "DAY" | "MAFIA" | "GHOST">("LOBBY");
  const [chatMessage, setChatMessage] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [targetSelections, setTargetSelections] = useState<Record<string, string>>({});
  const [pendingRoomBusy, setPendingRoomBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedDemoUser = readLocalStorage(STORAGE_KEYS.demoUser);
    const storedToken = readLocalStorage(STORAGE_KEYS.demoToken);
    const storedRoomId = readLocalStorage(STORAGE_KEYS.lastRoomId);

    if (storedDemoUser) {
      try {
        const parsed = JSON.parse(storedDemoUser) as Partial<DemoIdentity>;
        if (typeof parsed.userId === "string" && typeof parsed.email === "string" && typeof parsed.nickname === "string") {
          setIdentity((current) => ({
            ...current,
            userId: parsed.userId ?? current.userId,
            email: parsed.email ?? current.email,
            nickname: parsed.nickname ?? current.nickname,
            token: storedToken ?? current.token,
          }));
        }
      } catch {
        // ignore malformed demo state
      }
    } else if (storedToken) {
      setIdentity((current) => ({
        ...current,
        token: storedToken,
      }));
    }

    if (storedRoomId) {
      setRoomIdInput(storedRoomId);
    }

    if (!storedDemoUser && !storedToken) {
      setIdentity(createDemoIdentity());
    }

    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEYS.demoUser,
      JSON.stringify({
        userId: identity.userId,
        email: identity.email,
        nickname: identity.nickname,
      }),
    );
  }, [identity.email, identity.nickname, identity.userId]);

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") {
      return;
    }

    if (identity.token) {
      window.localStorage.setItem(STORAGE_KEYS.demoToken, identity.token);
    }
  }, [identity.token]);

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") {
      return;
    }

    if (roomIdInput.trim()) {
      window.localStorage.setItem(STORAGE_KEYS.lastRoomId, roomIdInput.trim());
    }
  }, [roomIdInput]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socketRef.current = socket;
    setSocketStatus(socket.connected ? "connected" : "connecting");

    const handleConnect = () => {
      setSocketStatus("connected");
      setSocketId(socket.id ?? "");
      appendEventLog({
        title: "connect",
        kind: "success",
        payload: {
          socketId: socket.id ?? "",
          userId: identity.userId,
        },
      });
    };

    const handleDisconnect = (reason: string) => {
      setSocketStatus("disconnected");
      appendEventLog({
        title: "disconnect",
        kind: "info",
        payload: { reason },
      });
    };

    const handleConnectError = (error: Error) => {
      setSocketStatus("error");
      setConnectionError(error.message);
      appendEventLog({
        title: "connect_error",
        kind: "error",
        payload: { message: error.message },
      });
    };

    const handleRoomUpdated = (payload: unknown) => {
      const parsedRoom = parseRoomPayload(payload);

      if (parsedRoom) {
        setRoom(parsedRoom);
        setRoomIdInput(parsedRoom.roomId);
      }

      appendEventLog({
        title: "room:updated",
        kind: "info",
        payload,
      });
    };

    const handleGameStarted = (event: GameStartedEvent) => {
      setSession((current) =>
        normalizeSession(current, room, identity.userId, {
          phase: "NIGHT",
          turn: 0,
        }),
      );
      appendEventLog({
        title: "game:started",
        kind: "success",
        payload: event,
      });
    };

    const handleRoleAssigned = (event: RoleAssignedEvent) => {
      if (event.userId === identity.userId) {
        setMyRole(event.role);
        setSession((current) =>
          updateSessionRole(current, event.userId, event.role, identity.userId, room),
        );
      }

      appendEventLog({
        title: "role:assigned",
        kind: event.userId === identity.userId ? "success" : "info",
        payload: event,
      });
    };

    const handlePhaseChanged = (event: PhaseChangedEvent) => {
      setSession((current) =>
        normalizeSession(current, room, identity.userId, {
          phase: event.toPhase,
          turn: event.turn,
        }),
      );
      appendEventLog({
        title: "phase:changed",
        kind: "success",
        payload: event,
      });
    };

    const handlePlayerDisconnected = (event: PlayerDisconnectedEvent) => {
      setSession((current) =>
        updateSessionConnectionStatus(current, event.userId, "DISCONNECTED", room, identity.userId),
      );
      appendEventLog({
        title: "player:disconnected",
        kind: "info",
        payload: event,
      });
    };

    const handleChatMessage = (event: ChatMessageEvent) => {
      addChatMessage(event);
      appendEventLog({
        title: "chat:message",
        kind: event.channel === "GHOST" ? "info" : "success",
        payload: event,
      });
    };

    const handleReconnectState = (event: ReconnectStateEvent) => {
      setRestored(event.restored);
      setReconnectReason(event.reason);
      setRoomIdInput((current) => event.roomId ?? current);
      setServerAvailableActions(event.availableActions ?? []);

      if (event.roomId) {
        void refreshRoom(event.roomId);
      }

      const nextSession = parseReconnectSession(event.session);
      const nextPlayer = parseReconnectPlayer(event.player);

      if (nextSession) {
        setSession(nextSession);
      }

      if (nextPlayer?.role) {
        setMyRole(String(nextPlayer.role));
      }

      if (nextPlayer?.status) {
        setMyStatus(String(nextPlayer.status));
      }

      if (nextPlayer?.connectionStatus) {
        setMyConnectionStatus(String(nextPlayer.connectionStatus));
      }

      if (Array.isArray(event.recentChats)) {
        for (const channelSnapshot of event.recentChats) {
          if (!channelSnapshot || typeof channelSnapshot !== "object") {
            continue;
          }

          const snapshot = channelSnapshot as {
            channel?: string;
            messages?: ChatMessageEvent[];
          };

          if (!snapshot.messages || !Array.isArray(snapshot.messages)) {
            continue;
          }

          for (const message of snapshot.messages) {
            addChatMessage(message);
          }
        }
      }

      appendEventLog({
        title: "reconnect:state",
        kind: event.restored ? "success" : "info",
        payload: event,
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("room:updated", handleRoomUpdated);
    socket.on("game:started", handleGameStarted);
    socket.on("role:assigned", handleRoleAssigned);
    socket.on("phase:changed", handlePhaseChanged);
    socket.on("player:disconnected", handlePlayerDisconnected);
    socket.on("chat:message", handleChatMessage);
    socket.on("reconnect:state", handleReconnectState);

    const acceptHandler = (event: CommandAcceptedEvent) => {
      const requestId = event.requestId;
      if (!requestId) {
        return;
      }

      const waiter = commandWaiters.current.get(requestId);
      if (waiter) {
        clearTimeout(waiter.timer);
        commandWaiters.current.delete(requestId);
        waiter.resolve(event);
      }
    };

    const rejectHandler = (event: CommandRejectedEvent) => {
      const requestId = event.requestId;
      if (!requestId) {
        return;
      }

      const waiter = commandWaiters.current.get(requestId);
      if (waiter) {
        clearTimeout(waiter.timer);
        commandWaiters.current.delete(requestId);
        waiter.resolve(event);
      }
    };

    socket.on("command:accepted", acceptHandler);
    socket.on("command:rejected", rejectHandler);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:updated", handleRoomUpdated);
      socket.off("game:started", handleGameStarted);
      socket.off("role:assigned", handleRoleAssigned);
      socket.off("phase:changed", handlePhaseChanged);
      socket.off("player:disconnected", handlePlayerDisconnected);
      socket.off("chat:message", handleChatMessage);
      socket.off("reconnect:state", handleReconnectState);
      socket.off("command:accepted", acceptHandler);
      socket.off("command:rejected", rejectHandler);
    };
  }, [identity.userId, room, socket]);

  useEffect(() => {
    const currentParticipant = room?.participants.find(
      (participant) => participant.userId === identity.userId,
    );

    if (typeof currentParticipant?.isReady === "boolean") {
      setIsReady(currentParticipant.isReady);
    }
  }, [identity.userId, room]);

  useEffect(() => {
    const currentPlayer = session?.players.find(
      (player) => player.userId === identity.userId,
    );

    if (!currentPlayer) {
      return;
    }

    setMyRole((current) => currentPlayer.role || current);
    setMyStatus((current) => currentPlayer.status || current);
    setMyConnectionStatus((current) => currentPlayer.connectionStatus || current);
  }, [identity.userId, session]);

  const derivedAvailableActions = useMemo(
    () =>
      deriveAvailableActions({
        room,
        session,
        userId: identity.userId,
        myRole,
        myStatus,
        myConnectionStatus,
      }),
    [identity.userId, myConnectionStatus, myRole, myStatus, room, session],
  );

  const effectiveAvailableActions =
    session ? derivedAvailableActions : serverAvailableActions;

  useEffect(() => {
    if (!session || !room) {
      return;
    }

    setTargetSelections((current) => {
      const next = { ...current };

      for (const action of effectiveAvailableActions) {
        if (action.targetUserIds?.length) {
          const currentTarget = next[action.type];
          if (!currentTarget || !action.targetUserIds.includes(currentTarget)) {
            next[action.type] = action.targetUserIds[0] ?? "";
          }
        }
      }

      return next;
    });
  }, [effectiveAvailableActions, room, session]);

  useEffect(() => {
    const allowedChannels = getAllowedChatChannels(room, effectiveAvailableActions);

    if (!allowedChannels.includes(chatChannel)) {
      setChatChannel(allowedChannels[0] ?? "LOBBY");
    }
  }, [chatChannel, effectiveAvailableActions, room]);

  const gamePlayers = useMemo(() => {
    if (session?.players?.length) {
      return session.players;
    }

    if (!room?.participants?.length) {
      return [];
    }

    return room.participants.map((participant) => ({
      userId: participant.userId,
      nickname: participant.nickname,
      role: participant.userId === identity.userId ? myRole || "UNKNOWN" : "UNKNOWN",
      status: participant.userId === identity.userId ? myStatus || "ALIVE" : "ALIVE",
      connectionStatus:
        participant.userId === identity.userId
          ? myConnectionStatus || "CONNECTED"
          : "CONNECTED",
    }));
  }, [identity.userId, myConnectionStatus, myRole, myStatus, room, session]);

  const visibleAllowedChannels = useMemo(() => {
    return getAllowedChatChannels(room, effectiveAvailableActions);
  }, [effectiveAvailableActions, room]);

  const currentPhase = session?.phase ?? room?.status ?? "WAITING";
  const currentTurn = session?.turn ?? 0;
  const currentRoomId = room?.roomId ?? roomIdInput.trim();
  const currentUserId = identity.userId;

  async function handleCreateToken() {
    try {
      const token = await createDemoToken({
        userId: identity.userId,
        email: identity.email,
      });

      setIdentity((current) => ({
        ...current,
        token,
      }));
      appendEventLog({
        title: "demo token 발급",
        kind: "success",
        payload: {
          userId: identity.userId,
          email: identity.email,
        },
      });
      setConnectionError("");
    } catch (error) {
      handleError("demo token 발급 실패", error);
    }
  }

  function handleConnectSocket() {
    if (!identity.token) {
      setConnectionError("먼저 토큰을 발급하거나 입력하세요.");
      return;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setSocketStatus("connecting");
    setConnectionError("");

    const nextSocket = createSocket(identity.token);
    setSocket(nextSocket);
    socketRef.current = nextSocket;
    nextSocket.connect();
  }

  function handleDisconnectSocket() {
    socketRef.current?.disconnect();
    setSocketStatus("disconnected");
    setSocketId("");
    setSocket(null);
  }

  async function handleCreateRoom() {
    try {
      const created = await createRoom({
        hostUserId: identity.userId,
        name: roomNameInput,
      });

      setRoom(created);
      setRoomIdInput(created.roomId);
      setReconnectReason("");
      setRestored(false);
      appendEventLog({
        title: "방 생성",
        kind: "success",
        payload: created,
      });
      setConnectionError("");

      if (socketRef.current?.connected) {
        try {
          const response = await sendCommand({
            type: "JOIN_ROOM",
            gameId: created.roomId,
            payload: {
              nickname: identity.nickname,
            },
          });

          if (response.type === "COMMAND_ACCEPTED") {
            appendEventLog({
              title: "host socket room join",
              kind: "success",
              payload: {
                roomId: created.roomId,
              },
            });
          } else {
            appendEventLog({
              title: "host socket room join failed",
              kind: "error",
              payload: response,
            });
          }
        } catch (error) {
          handleError("host socket room join failed", error);
        }
      } else {
        appendEventLog({
          title: "host socket room join skipped",
          kind: "info",
          payload: {
            message:
              "소켓 연결 후 방 참가 버튼을 눌러야 room broadcast를 받을 수 있습니다.",
            roomId: created.roomId,
          },
        });
      }
    } catch (error) {
      handleError("방 생성 실패", error);
    }
  }

  async function handleLoadRoom() {
    const targetRoomId = roomIdInput.trim();

    if (!targetRoomId) {
      setConnectionError("roomId를 입력하세요.");
      return;
    }

    try {
      const loaded = await getRoom(targetRoomId);
      setRoom(loaded);
      appendEventLog({
        title: "방 조회",
        kind: "success",
        payload: loaded,
      });
      setConnectionError("");
    } catch (error) {
      handleError("방 조회 실패", error);
    }
  }

  async function handleJoinRoom() {
    const response = await sendCommand({
      type: "JOIN_ROOM",
      gameId: roomIdInput.trim(),
      payload: {
        nickname: identity.nickname,
      },
    });

    if (response.type === "COMMAND_ACCEPTED") {
      setRoomIdInput(roomIdInput.trim());
      setPendingRoomBusy(false);
    }
  }

  async function handleToggleReady() {
    const next = !isReady;
    setIsReady(next);

    const response = await sendCommand({
      type: "CHANGE_READY",
      gameId: roomIdInput.trim(),
      payload: {
        isReady: next,
      },
    });

    if (response.type === "COMMAND_REJECTED") {
      setIsReady((current) => !current);
    }
  }

  async function handleStartGame() {
    await sendCommand({
      type: "START_GAME",
      gameId: roomIdInput.trim(),
      payload: {},
    });
  }

  async function handleNextPhase() {
    await sendCommand({
      type: "NEXT_PHASE",
      gameId: roomIdInput.trim(),
      payload: {},
    });
  }

  async function handleTargetAction(actionType: AvailableAction["type"]) {
    const targetUserId = targetSelections[actionType];

    if (!targetUserId) {
      setConnectionError("대상 플레이어를 선택하세요.");
      return;
    }

    await sendCommand({
      type: actionType,
      gameId: roomIdInput.trim(),
      payload: {
        targetUserId,
      },
    });
  }

  async function handleSendChat() {
    if (!roomIdInput.trim()) {
      setConnectionError("방을 먼저 선택하세요.");
      return;
    }

    const response = await sendCommand({
      type: "SEND_CHAT_MESSAGE",
      gameId: roomIdInput.trim(),
      payload: {
        channel: chatChannel,
        message: chatMessage,
      },
    });

    if (response.type === "COMMAND_ACCEPTED") {
      setChatMessage("");
    }
  }

  async function refreshRoom(targetRoomId: string) {
    try {
      const loaded = await getRoom(targetRoomId);
      setRoom(loaded);
    } catch {
      // reconnect flow is best-effort here
    }
  }

  async function sendCommand(input: {
    type: CommandEnvelope["type"];
    gameId: string;
    payload: Record<string, unknown>;
  }): Promise<CommandResponse> {
    if (!socketRef.current) {
      throw new Error("소켓이 연결되지 않았습니다.");
    }

    const requestId = createRequestId(input.type);
    const responsePromise = new Promise<CommandResponse>((resolve) => {
      const timer = setTimeout(() => {
        commandWaiters.current.delete(requestId);
        resolve({
          type: "COMMAND_REJECTED",
          requestId,
          reason: "ROOM_COMMAND_FAILED",
          message: "command response timed out",
        });
      }, 5000);

      commandWaiters.current.set(requestId, {
        resolve,
        timer,
      });
    });

    socketRef.current.emit("command", {
      type: input.type,
      requestId,
      gameId: input.gameId,
      payload: input.payload,
    } satisfies CommandEnvelope);

    const response = await responsePromise;
    appendEventLog({
      title: `command ${response.type === "COMMAND_ACCEPTED" ? "accepted" : "rejected"}`,
      kind: response.type === "COMMAND_ACCEPTED" ? "success" : "error",
      payload: response,
    });

    if (response.type === "COMMAND_REJECTED") {
      if (response.reason === "GAME_LOCK_BUSY") {
        setPendingRoomBusy(true);
      }

      if (response.reason === "ROOM_NOT_FOUND") {
        setRoom(null);
      }
    }

    return response;
  }

  function handleError(title: string, error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    setConnectionError(message);
    appendEventLog({
      title,
      kind: "error",
      payload: { message },
    });
  }

  function appendEventLog(entry: Omit<EventLogEntry, "id" | "timestamp">) {
    setEventLog((current) => [
      {
        id: createRequestId("log"),
        timestamp: new Date().toISOString(),
        ...entry,
      },
      ...current,
    ].slice(0, 100));
  }

  function addChatMessage(message: ChatMessageEvent) {
    const key = buildChatKey(message);
    if (knownChatKeys.current.has(key)) {
      return;
    }

    knownChatKeys.current.add(key);

    setChatMessages((current) => [
      {
        ...message,
        id: key,
      },
      ...current,
    ].slice(0, 100));
  }

  function handleDemoUserChange(nextUserId: string) {
    const userId = nextUserId.trim() || createDemoIdentity().userId;
    setIdentity((current) => ({
      ...current,
      userId,
      email: current.email || `${userId}@example.com`,
      nickname: current.nickname || userId,
    }));
  }

  function handleEmailChange(nextEmail: string) {
    setIdentity((current) => ({
      ...current,
      email: nextEmail,
    }));
  }

  function handleNicknameChange(nextNickname: string) {
    setIdentity((current) => ({
      ...current,
      nickname: nextNickname,
    }));
  }

  return (
    <main className="page play-page">
      <header className="play-header">
        <div className="play-header__title">
          <p className="eyebrow">Mafia Casefile</p>
          <span className="play-badge">데모 UI</span>
          <Link className="button button--ghost" href="/">
            홈으로
          </Link>
        </div>
        <h1>실시간 4인 플레이 화면</h1>
        <p className="hero-copy">
          데모 토큰을 발급하거나 붙여넣고, 같은 방에 4명이 들어간 뒤 ready와
          start를 진행해 보세요. reconnect, 채팅, 밤 액션, 투표, 복기 링크까지
          한 화면에 모았습니다.
        </p>
        <div className="meta-value">
          {socketStatus === "connected"
            ? `연결됨 · socket ${socketId || "unknown"}`
            : socketStatus === "connecting"
              ? "연결 중..."
              : socketStatus === "error"
                ? `연결 오류 · ${connectionError || "알 수 없음"}`
                : "아직 연결되지 않았습니다."}
        </div>
      </header>

      <section className="play-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Demo Identity</p>
              <h2>토큰과 사용자 정보</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="field-grid">
              <label className="field">
                <span>userId</span>
                <input
                  value={identity.userId}
                  onChange={(event) => handleDemoUserChange(event.target.value)}
                  placeholder="demo-user-1"
                />
              </label>
              <label className="field">
                <span>email</span>
                <input
                  value={identity.email}
                  onChange={(event) => handleEmailChange(event.target.value)}
                  placeholder="demo-user-1@example.com"
                />
              </label>
              <label className="field">
                <span>nickname</span>
                <input
                  value={identity.nickname}
                  onChange={(event) => handleNicknameChange(event.target.value)}
                  placeholder="demo-user-1"
                />
              </label>
            </div>
            <label className="field">
              <span>token</span>
              <textarea
                value={identity.token}
                onChange={(event) =>
                  setIdentity((current) => ({
                    ...current,
                    token: event.target.value,
                  }))
                }
                placeholder="토큰 발급 또는 붙여넣기"
              />
            </label>
            <div className="identity-actions">
              <div className="connection-grid">
                <button className="button button--primary" onClick={handleCreateToken}>
                  토큰 발급
                </button>
                <button className="button button--secondary" onClick={handleConnectSocket}>
                  소켓 연결
                </button>
              </div>
              <button className="button button--ghost" onClick={handleDisconnectSocket}>
                연결 해제
              </button>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Room</p>
              <h2>방 생성과 참가</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="room-actions">
              <label className="field">
                <span>roomId</span>
                <input
                  value={roomIdInput}
                  onChange={(event) => setRoomIdInput(event.target.value)}
                  placeholder="방 생성 후 자동 입력됩니다"
                />
              </label>
              <label className="field">
                <span>roomName</span>
                <input
                  value={roomNameInput}
                  onChange={(event) => setRoomNameInput(event.target.value)}
                  placeholder="데모 방"
                />
              </label>
            </div>
            <div className="room-actions">
              <button className="button button--primary" onClick={handleCreateRoom}>
                방 생성
              </button>
              <button className="button button--secondary" onClick={handleLoadRoom}>
                방 조회
              </button>
              <button
                className="button button--secondary"
                onClick={handleJoinRoom}
                disabled={!roomIdInput.trim() || !socket}
              >
                방 참가
              </button>
              <button
                className="button button--secondary"
                onClick={handleToggleReady}
                disabled={!roomIdInput.trim() || !socket}
              >
                {isReady ? "Ready 해제" : "Ready 토글"}
              </button>
              <button
                className="button button--primary"
                onClick={handleStartGame}
                disabled={!roomIdInput.trim() || !socket}
              >
                게임 시작
              </button>
            </div>
            <div className="room-meta">
              <span className="meta-value">
                current room: <strong>{currentRoomId || "없음"}</strong>
              </span>
              <span className="meta-value">
                room status: <strong>{room?.status ?? "UNKNOWN"}</strong>
              </span>
              <span className="meta-value">
                {pendingRoomBusy ? "락이 바쁜 상태입니다." : "락 상태는 이벤트 로그를 확인하세요."}
              </span>
            </div>
            <p className="section-note">
              방 생성 후 host socket은 자동으로 방에 참가합니다. 실패하면 방 참가 버튼을 다시 누르세요.
            </p>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Connection</p>
              <h2>연결과 복구 상태</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="summary-stack">
              <div className="metric-card">
                <span className="meta-label">socket</span>
                <strong>{socketStatus}</strong>
              </div>
              <div className="metric-card">
                <span className="meta-label">userId</span>
                <strong>{currentUserId}</strong>
              </div>
              <div className="metric-card">
                <span className="meta-label">roomId</span>
                <strong>{currentRoomId || "없음"}</strong>
              </div>
              <div className="metric-card">
                <span className="meta-label">reconnect</span>
                <strong>{restored ? "restored" : "idle"}</strong>
              </div>
            </div>
            <div className="connection-grid">
              <div className="connection-card">
                <span className="meta-label">reason</span>
                <strong>{reconnectReason || "없음"}</strong>
              </div>
              <div className="connection-card">
                <span className="meta-label">my role</span>
                <strong>{myRole || "UNKNOWN"}</strong>
              </div>
              <div className="connection-card">
                <span className="meta-label">my status</span>
                <strong>{myStatus || "UNKNOWN"}</strong>
              </div>
              <div className="connection-card">
                <span className="meta-label">connection</span>
                <strong>{myConnectionStatus || "UNKNOWN"}</strong>
              </div>
            </div>
            <p className="helper-text">
              reconnect:state가 오면 room/session/player/recentChats/availableActions를
              복구합니다.
            </p>
          </div>
        </article>

        <article className="panel panel--wide">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Game State</p>
              <h2>phase, turn, player 상태</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="summary-stack">
              <div className="metric-card">
                <span className="meta-label">phase</span>
                <strong>{currentPhase}</strong>
              </div>
              <div className="metric-card">
                <span className="meta-label">turn</span>
                <strong>{currentTurn}</strong>
              </div>
              <div className="metric-card">
                <span className="meta-label">participants</span>
                <strong>{room?.participants.length ?? gamePlayers.length}</strong>
              </div>
              <div className="metric-card">
                <span className="meta-label">available actions</span>
                <strong>{effectiveAvailableActions.length}</strong>
              </div>
            </div>
            <div className="room-card">
              <span className="section-kicker">Players</span>
              <div className="player-list">
                {gamePlayers.length === 0 ? (
                  <p className="connection-empty">아직 플레이어 정보가 없습니다.</p>
                ) : (
                  gamePlayers.map((player) => {
                    const isMe = player.userId === identity.userId;
                    return (
                      <article
                        key={player.userId}
                        className={[
                          "player-item",
                          isMe ? "player-item--highlight" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <div className="player-item__header">
                          <p className="player-item__name">
                            {player.nickname ?? player.userId}
                            {isMe ? " (me)" : ""}
                          </p>
                          <div className="player-item__meta">
                            <span className="status-pill">{player.userId}</span>
                            <span className={`status-pill ${statusClass(player.status)}`}>
                              {player.status}
                            </span>
                            <span className={`status-pill ${statusClass(player.connectionStatus)}`}>
                              {player.connectionStatus}
                            </span>
                            <span
                              className={`status-pill ${
                                isPlayerReady(room, player.userId)
                                  ? "status-pill--good"
                                  : "status-pill--warn"
                              }`}
                            >
                              {isPlayerReady(room, player.userId) ? "READY" : "NOT READY"}
                            </span>
                          </div>
                        </div>
                        <div className="player-item__meta">
                          <span className="meta-value">
                            role: <strong>{player.role || "UNKNOWN"}</strong>
                          </span>
                          {isMe ? (
                            <span className="meta-value">
                              ready: <strong>{isReady ? "READY" : "NOT READY"}</strong>
                            </span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
            <div className="room-card">
              <span className="section-kicker">Available Actions</span>
              {effectiveAvailableActions.length === 0 ? (
                <p className="connection-empty">
                  현재 phase/role/status 기준 가능한 액션이 없습니다. 서버 reject가 최종 권한입니다.
                </p>
              ) : (
                <div className="available-action-grid">
                  {effectiveAvailableActions.map((action) => (
                    <ActionCard
                      key={actionKey(action)}
                      action={action}
                      players={gamePlayers}
                      selectedTarget={targetSelections[action.type] ?? ""}
                      onSelectTarget={(targetUserId) =>
                        setTargetSelections((current) => ({
                          ...current,
                          [action.type]: targetUserId,
                        }))
                      }
                      onExecute={handleTargetAction}
                      onNextPhase={handleNextPhase}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Chat</p>
              <h2>채팅</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="channel-status-list">
              <div className="meta-value">
                선택 가능한 채널:{" "}
                {visibleAllowedChannels.length > 0 ? (
                  visibleAllowedChannels.map((channel) => (
                    <span
                      key={channel}
                      className={`channel-pill channel-pill--${channel}`}
                    >
                      {channel}
                    </span>
                  ))
                ) : (
                  <span className="connection-empty">없음</span>
                )}
              </div>
              <p className="section-note">
                LOBBY는 대기실에서, DAY는 낮 토론에서, MAFIA는 밤 마피아 대화에서,
                GHOST는 사망자에게 허용됩니다.
              </p>
            </div>
            <div className="chat-inputs">
              <label className="field">
                <span>channel</span>
                <select
                  value={chatChannel}
                  onChange={(event) => setChatChannel(event.target.value as typeof chatChannel)}
                >
                  {DEFAULT_CHAT_CHANNELS.map((channel) => (
                    <option
                      key={channel}
                      value={channel}
                      disabled={!isChannelAllowed(channel, room, effectiveAvailableActions)}
                    >
                      {channel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>message</span>
                <textarea
                  value={chatMessage}
                  onChange={(event) => setChatMessage(event.target.value)}
                  placeholder="채팅 메시지"
                />
              </label>
              <button className="button button--primary" onClick={handleSendChat}>
                전송
              </button>
            </div>
            <div className="chat-list">
              {chatMessages.length === 0 ? (
                <p className="connection-empty">아직 채팅이 없습니다.</p>
              ) : (
                chatMessages.map((message) => (
                  <article key={message.id} className="chat-message">
                    <div className="chat-message__header">
                      <p className="chat-message__name">
                        {message.senderUserId ?? "system"}
                      </p>
                      <div className="chat-message__meta">
                        <span className={`channel-pill channel-pill--${message.channel}`}>
                          {message.channel}
                        </span>
                        <span className="meta-value">{message.sentAt}</span>
                      </div>
                    </div>
                    <p className="chat-message__body">{message.message}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Event Log</p>
              <h2>최근 100개 이벤트</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="event-log-list">
              {eventLog.length === 0 ? (
                <p className="connection-empty">이벤트가 아직 없습니다.</p>
              ) : (
                eventLog.map((entry) => (
                  <article key={entry.id} className={`event-log-item event-log-item--${entry.kind}`}>
                    <div className="event-log-item__header">
                      <p className="event-log-item__name">{entry.title}</p>
                      <div className="event-log-item__meta">
                        <span className="status-pill">{entry.kind}</span>
                        <span className="meta-value">{entry.timestamp}</span>
                      </div>
                    </div>
                    <pre>{formatJson(entry.payload)}</pre>
                  </article>
                ))
              )}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Timeline Link</p>
              <h2>결과 타임라인</h2>
            </div>
          </div>
          <div className="panel-body">
            {currentRoomId ? (
              <Link
                className="button button--primary"
                href={`/games/${encodeURIComponent(currentRoomId)}/timeline`}
              >
                /games/{currentRoomId}/timeline
              </Link>
            ) : (
              <p className="connection-empty">roomId가 있으면 타임라인 링크가 표시됩니다.</p>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function ActionCard({
  action,
  players,
  selectedTarget,
  onSelectTarget,
  onExecute,
  onNextPhase,
}: {
  action: AvailableAction;
  players: GameSessionPlayerView[];
  selectedTarget: string;
  onSelectTarget: (targetUserId: string) => void;
  onExecute: (actionType: AvailableAction["type"]) => Promise<void>;
  onNextPhase: () => Promise<void>;
}) {
  if (action.type === "NEXT_PHASE") {
    return (
      <article className="available-action">
        <div className="available-action__header">
          <div>
            <p className="action-title">다음 phase</p>
            <p className="helper-text">host만 사용할 수 있습니다.</p>
          </div>
          <button className="button button--primary" onClick={onNextPhase}>
            실행
          </button>
        </div>
      </article>
    );
  }

  if (action.type === "SEND_CHAT_MESSAGE") {
    return (
      <article className="available-action">
        <div className="available-action__header">
          <div>
            <p className="action-title">채팅 가능</p>
            <p className="helper-text">
              현재 선택된 channel은 채팅 섹션에서 전송됩니다.
            </p>
          </div>
          {action.channel ? <span className={`channel-pill channel-pill--${action.channel}`}>{action.channel}</span> : null}
        </div>
      </article>
    );
  }

  const targetUsers =
    action.targetUserIds?.length
      ? players.filter((player) => action.targetUserIds?.includes(player.userId))
      : players;

  return (
    <article className="available-action">
      <div className="available-action__header">
        <div>
          <p className="action-title">{getActionTitle(action.type)}</p>
          <p className="helper-text">
            {action.type}를 실행할 대상을 선택하세요.
          </p>
        </div>
        <button
          className="button button--secondary"
          onClick={() => void onExecute(action.type)}
          disabled={!selectedTarget}
        >
          실행
        </button>
      </div>
      <div className="target-action-row">
        <label className="field">
          <span>target</span>
          <select
            value={selectedTarget}
            onChange={(event) => onSelectTarget(event.target.value)}
          >
            {targetUsers.map((player) => (
              <option key={player.userId} value={player.userId}>
                {player.nickname || player.userId} ({player.userId})
              </option>
            ))}
          </select>
        </label>
        <div className="available-action__targets">
          {targetUsers.map((player) => (
            <button
              key={player.userId}
              className={`button ${selectedTarget === player.userId ? "button--primary" : "button--secondary"}`}
              onClick={() => onSelectTarget(player.userId)}
            >
              {player.nickname || player.userId}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function createDemoIdentity(): DemoIdentity {
  const userId = `demo-user-${shortSuffix()}`;

  return {
    userId,
    email: `${userId}@example.com`,
    nickname: userId,
    token: "",
  };
}

function createRequestId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? shortSuffix(10)}`;
}

function shortSuffix(length = 6) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length);
}

function readLocalStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function actionKey(action: AvailableAction) {
  return `${action.type}:${action.channel ?? ""}:${action.targetUserIds?.join(",") ?? ""}`;
}

function getActionTitle(type: AvailableAction["type"]) {
  switch (type) {
    case "CAST_VOTE":
      return "투표";
    case "SELECT_MAFIA_TARGET":
      return "마피아 target 선택";
    case "SELECT_DOCTOR_TARGET":
      return "의사 target 선택";
    case "SELECT_POLICE_TARGET":
      return "경찰 조사";
    default:
      return type;
  }
}

function isChannelAllowed(
  channel: "LOBBY" | "DAY" | "MAFIA" | "GHOST",
  room: RoomView | null,
  availableActions: AvailableAction[],
) {
  if (channel === "LOBBY") {
    return room?.status === "WAITING";
  }

  return availableActions.some(
    (action) =>
      action.type === "SEND_CHAT_MESSAGE" && action.channel === channel,
  );
}

function getAllowedChatChannels(
  room: RoomView | null,
  availableActions: AvailableAction[],
) {
  return DEFAULT_CHAT_CHANNELS.filter((channel) =>
    isChannelAllowed(channel, room, availableActions),
  );
}

function parseRoomPayload(payload: unknown): RoomView | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const room = (payload as { room?: unknown }).room;

  if (!room || typeof room !== "object" || Array.isArray(room)) {
    return null;
  }

  const candidate = room as Record<string, unknown>;

  if (
    typeof candidate.roomId !== "string" ||
    typeof candidate.hostUserId !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.maxPlayers !== "number" ||
    typeof candidate.playerCount !== "number" ||
    !Array.isArray(candidate.participants)
  ) {
    return null;
  }

  return {
    roomId: candidate.roomId,
    hostUserId: candidate.hostUserId,
    name: candidate.name,
    status: candidate.status as RoomView["status"],
    maxPlayers: candidate.maxPlayers,
    playerCount: candidate.playerCount,
    participants: candidate.participants
      .filter((participant) => participant && typeof participant === "object" && !Array.isArray(participant))
      .map((participant) => {
        const current = participant as Record<string, unknown>;
        return {
          userId:
            typeof current.userId === "string" ? current.userId : "unknown",
          nickname:
            typeof current.nickname === "string"
              ? current.nickname
              : "unknown",
          isReady: typeof current.isReady === "boolean" ? current.isReady : false,
        };
      }),
  };
}

function parseReconnectSession(value: unknown): GameSessionView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const session = value as Record<string, unknown>;

  if (
    typeof session.gameId !== "string" ||
    typeof session.phase !== "string" ||
    typeof session.turn !== "number" ||
    !Array.isArray(session.players)
  ) {
    return null;
  }

  return {
    gameId: session.gameId,
    phase: session.phase,
    turn: session.turn,
    players: session.players
      .filter((player) => player && typeof player === "object" && !Array.isArray(player))
      .map((player) => {
        const current = player as Record<string, unknown>;
        return {
          userId: typeof current.userId === "string" ? current.userId : "unknown",
          nickname:
            typeof current.nickname === "string" ? current.nickname : "unknown",
          role: typeof current.role === "string" ? current.role : "UNKNOWN",
          status: typeof current.status === "string" ? current.status : "UNKNOWN",
          connectionStatus:
            typeof current.connectionStatus === "string"
              ? current.connectionStatus
              : "CONNECTED",
        };
      }),
  };
}

function parseReconnectPlayer(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const player = value as Record<string, unknown>;

  return {
    userId: typeof player.userId === "string" ? player.userId : null,
    role: typeof player.role === "string" ? player.role : null,
    status: typeof player.status === "string" ? player.status : null,
    connectionStatus:
      typeof player.connectionStatus === "string"
        ? player.connectionStatus
        : null,
  };
}

function normalizeSession(
  current: GameSessionView | null,
  room: RoomView | null,
  currentUserId: string,
  patch: Partial<Pick<GameSessionView, "phase" | "turn">>,
): GameSessionView {
  const basePlayers = current?.players?.length
    ? current.players
    : room?.participants.map((participant) => ({
        userId: participant.userId,
        nickname: participant.nickname,
        role: participant.userId === currentUserId ? "UNKNOWN" : "UNKNOWN",
        status: "ALIVE",
        connectionStatus: "CONNECTED",
      })) ?? [];

  return {
    gameId: current?.gameId ?? room?.roomId ?? "",
    phase: patch.phase ?? current?.phase ?? "WAITING",
    turn: patch.turn ?? current?.turn ?? 0,
    players: basePlayers,
  };
}

function isPlayerReady(room: RoomView | null, userId: string) {
  return room?.participants.some(
    (participant) => participant.userId === userId && participant.isReady,
  ) ?? false;
}

function updateSessionRole(
  current: GameSessionView | null,
  userId: string,
  role: string,
  currentUserId: string,
  room: RoomView | null,
): GameSessionView {
  const base = normalizeSession(current, room, currentUserId, {});

  return {
    ...base,
    players: base.players.map((player) =>
      player.userId === userId
        ? {
            ...player,
            role,
          }
        : player,
    ),
  };
}

function updateSessionConnectionStatus(
  current: GameSessionView | null,
  userId: string,
  connectionStatus: string,
  room: RoomView | null,
  currentUserId: string,
): GameSessionView {
  const base = normalizeSession(current, room, currentUserId, {});

  return {
    ...base,
    players: base.players.map((player) =>
      player.userId === userId
        ? {
            ...player,
            connectionStatus,
          }
        : player,
    ),
  };
}

function buildChatKey(message: ChatMessageEvent) {
  return [
    message.gameId,
    message.channel,
    message.senderUserId ?? "null",
    message.sentAt,
    message.message,
  ].join("|");
}

function statusClass(value: string) {
  if (value === "CONNECTED" || value === "ALIVE" || value === "restored") {
    return "status-pill--good";
  }

  if (value === "DISCONNECTED" || value === "DEAD") {
    return "status-pill--bad";
  }

  if (value === "UNKNOWN" || value === "idle") {
    return "status-pill--warn";
  }

  return "";
}

function deriveAvailableActions(input: {
  room: RoomView | null;
  session: GameSessionView | null;
  userId: string;
  myRole: string;
  myStatus: string;
  myConnectionStatus: string;
}): AvailableAction[] {
  if (!input.session) {
    return [];
  }

  const currentPlayer =
    input.session.players.find((player) => player.userId === input.userId) ?? null;

  if (!currentPlayer) {
    return [];
  }

  const effectiveRole = currentPlayer.role || input.myRole;
  const effectiveStatus = currentPlayer.status || input.myStatus;
  const effectiveConnectionStatus =
    currentPlayer.connectionStatus || input.myConnectionStatus;

  if (effectiveConnectionStatus === "DISCONNECTED") {
    return [];
  }

  if (input.session.phase === "FINISHED") {
    return [];
  }

  const alivePlayerIds = input.session.players
    .filter((player) => player.status === "ALIVE")
    .map((player) => player.userId);

  const actions: AvailableAction[] = [];

  if (
    input.room?.hostUserId === input.userId &&
    (input.room.status === "IN_PROGRESS" || Boolean(input.session)) &&
    input.session.phase !== "FINISHED"
  ) {
    actions.push({ type: "NEXT_PHASE" });
  }

  if (effectiveStatus === "DEAD") {
    actions.push({ type: "SEND_CHAT_MESSAGE", channel: "GHOST" });
    return dedupeAvailableActions(actions);
  }

  if (input.session.phase === "NIGHT" && effectiveStatus === "ALIVE") {
    if (effectiveRole === "MAFIA") {
      actions.push({
        type: "SELECT_MAFIA_TARGET",
        targetUserIds: alivePlayerIds,
      });
      actions.push({ type: "SEND_CHAT_MESSAGE", channel: "MAFIA" });
    }

    if (effectiveRole === "DOCTOR") {
      actions.push({
        type: "SELECT_DOCTOR_TARGET",
        targetUserIds: alivePlayerIds,
      });
    }

    if (effectiveRole === "POLICE") {
      actions.push({
        type: "SELECT_POLICE_TARGET",
        targetUserIds: alivePlayerIds,
      });
    }
  }

  if (input.session.phase === "DAY_DISCUSSION" && effectiveStatus === "ALIVE") {
    actions.push({ type: "SEND_CHAT_MESSAGE", channel: "DAY" });
  }

  if (input.session.phase === "VOTING" && effectiveStatus === "ALIVE") {
    actions.push({ type: "CAST_VOTE", targetUserIds: alivePlayerIds });
  }

  return dedupeAvailableActions(actions);
}

function dedupeAvailableActions(actions: AvailableAction[]) {
  const seen = new Set<string>();

  return actions.filter((action) => {
    const key = `${action.type}:${action.channel ?? ""}:${action.targetUserIds?.join(",") ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
