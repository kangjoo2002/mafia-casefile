"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessageEvent,
  CommandAcceptedEvent,
  CommandRejectedEvent,
  GameFinishedEvent,
  GameStartedEvent,
  InvestigationResultEvent,
  NightResolvedEvent,
  PhaseChangedEvent,
  PlayerDisconnectedEvent,
  ReconnectStateEvent,
  RoleAssignedEvent,
  VotingResolvedEvent,
  AvailableAction,
} from "@mafia-casefile/shared";
import { DebugLog } from "./components/DebugLog";
import { EntryScreen } from "./components/EntryScreen";
import { GameScreen } from "./components/GameScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import {
  getAllowedChatChannels,
  type PlayChatChannel,
} from "./lib/chat";
import {
  commandRejectMessage,
  displayChatChannel,
  displayPhase,
  displayRole,
} from "./lib/display";
import {
  getPhaseGuide,
  isTargetAction,
} from "./lib/play-ui";
import { deriveViewState } from "./lib/view-state";
import {
  createDemoToken,
  createRoom,
  getRoom,
} from "../../lib/api";
import type {
  ChatMessageView,
  DemoIdentity,
  EventLogEntry,
  GameNotice,
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
  const identityUserIdRef = useRef("demo-user");
  const roomRef = useRef<RoomView | null>(null);
  const sessionRef = useRef<GameSessionView | null>(null);

  const [identity, setIdentity] = useState<DemoIdentity>(() => ({
    userId: "demo-user",
    email: "demo-user@example.com",
    nickname: "플레이어",
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
  const [gameNotices, setGameNotices] = useState<GameNotice[]>([]);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("idle");
  const [connectionError, setConnectionError] = useState("");
  const [reconnectReason, setReconnectReason] = useState("");
  const [restored, setRestored] = useState(false);
  const [chatChannel, setChatChannel] = useState<PlayChatChannel>("LOBBY");
  const [chatMessage, setChatMessage] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [roomMode, setRoomMode] = useState<"create" | "join">("create");
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    identityUserIdRef.current = identity.userId;
  }, [identity.userId]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedDemoUser = readSessionStorage(STORAGE_KEYS.demoUser);
    const storedToken = readSessionStorage(STORAGE_KEYS.demoToken);
    const storedRoomId = readLocalStorage(STORAGE_KEYS.lastRoomId);
    setDebugMode(new URLSearchParams(window.location.search).get("debug") === "1");

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

    window.sessionStorage.setItem(
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
      window.sessionStorage.setItem(STORAGE_KEYS.demoToken, identity.token);
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
      appendEventLog({
        title: "connect",
        kind: "success",
        payload: {
          socketId: socket.id ?? "",
          userId: identityUserIdRef.current,
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
        normalizeSession(current, roomRef.current, identityUserIdRef.current, {
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
      const currentUserId = identityUserIdRef.current;

      if (event.userId === currentUserId) {
        setMyRole(event.role);
        setSession((current) =>
          updateSessionRole(current, event.userId, event.role, currentUserId, roomRef.current),
        );
      }

      appendEventLog({
        title: "role:assigned",
        kind: event.userId === currentUserId ? "success" : "info",
        payload: event,
      });
    };

    const handlePhaseChanged = (event: PhaseChangedEvent) => {
      setSession((current) =>
        normalizeSession(current, roomRef.current, identityUserIdRef.current, {
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

    const handleNightResolved = (event: NightResolvedEvent) => {
      if (event.killedUserId) {
        setSession((current) =>
          updateSessionPlayerStatus(
            current,
            event.killedUserId!,
            "DEAD",
            roomRef.current,
            identityUserIdRef.current,
          ),
        );
      }

      appendGameNotice({
        kind: event.killedUserId ? "error" : "success",
        message: formatNightResolution(event, sessionRef.current, roomRef.current),
      });
      appendEventLog({
        title: "night:resolved",
        kind: event.killedUserId ? "error" : "success",
        payload: event,
      });
    };

    const handleVotingResolved = (event: VotingResolvedEvent) => {
      if (event.executedUserId) {
        setSession((current) =>
          updateSessionPlayerStatus(
            current,
            event.executedUserId!,
            "DEAD",
            roomRef.current,
            identityUserIdRef.current,
          ),
        );
      }

      appendGameNotice({
        kind: event.executedUserId ? "error" : "info",
        message: formatVotingResolution(event, sessionRef.current, roomRef.current),
      });
      appendEventLog({
        title: "voting:resolved",
        kind: event.executedUserId ? "error" : "info",
        payload: event,
      });
    };

    const handleGameFinished = (event: GameFinishedEvent) => {
      setSession((current) =>
        current
          ? {
              ...current,
              phase: "FINISHED",
            }
          : current,
      );
      setRoom((current) =>
        current
          ? {
              ...current,
              status: "FINISHED",
            }
          : current,
      );
      appendGameNotice({
        kind: "success",
        message:
          event.winnerTeam === "MAFIA"
            ? "게임 종료: 마피아 팀이 승리했습니다."
            : "게임 종료: 시민 팀이 승리했습니다.",
      });
      appendEventLog({
        title: "game:finished",
        kind: "success",
        payload: event,
      });
    };

    const handleInvestigationResult = (event: InvestigationResultEvent) => {
      appendGameNotice({
        kind: event.result === "MAFIA" ? "error" : "success",
        message: `조사 결과: ${findPlayerName(sessionRef.current, roomRef.current, event.targetUserId)}은(는) ${displayRole(event.result)}입니다.`,
      });
      appendEventLog({
        title: "investigation:result",
        kind: "success",
        payload: event,
      });
    };

    const handlePlayerDisconnected = (event: PlayerDisconnectedEvent) => {
      setSession((current) =>
        updateSessionConnectionStatus(
          current,
          event.userId,
          "DISCONNECTED",
          roomRef.current,
          identityUserIdRef.current,
        ),
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
    socket.on("night:resolved", handleNightResolved);
    socket.on("voting:resolved", handleVotingResolved);
    socket.on("game:finished", handleGameFinished);
    socket.on("investigation:result", handleInvestigationResult);
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

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:updated", handleRoomUpdated);
      socket.off("game:started", handleGameStarted);
      socket.off("role:assigned", handleRoleAssigned);
      socket.off("phase:changed", handlePhaseChanged);
      socket.off("night:resolved", handleNightResolved);
      socket.off("voting:resolved", handleVotingResolved);
      socket.off("game:finished", handleGameFinished);
      socket.off("investigation:result", handleInvestigationResult);
      socket.off("player:disconnected", handlePlayerDisconnected);
      socket.off("chat:message", handleChatMessage);
      socket.off("reconnect:state", handleReconnectState);
      socket.off("command:accepted", acceptHandler);
      socket.off("command:rejected", rejectHandler);

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [socket]);

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

  const currentPhase = session?.phase ?? room?.status ?? "WAITING";
  const currentTurn = session?.turn ?? 0;
  const currentRoomId = room?.roomId ?? roomIdInput.trim();
  const currentRoomParticipant = room?.participants.find(
    (participant) => participant.userId === identity.userId,
  );
  const currentRoomReady = currentRoomParticipant?.isReady ?? isReady;
  const connected = socketStatus === "connected" && isSocketConnected(socketRef.current);
  const inRoom = Boolean(currentRoomParticipant || session);
  const roomControlsDisabled = !connected;
  const readyDisabled = !connected || !roomIdInput.trim() || !inRoom;
  const startDisabled =
    !connected ||
    !roomIdInput.trim() ||
    room?.hostUserId !== identity.userId ||
    room?.status !== "WAITING";
  const isGameStarted = Boolean(session) || room?.status === "IN_PROGRESS";
  const viewState = deriveViewState({
    connected,
    inRoom,
    isGameStarted,
    phase: currentPhase,
  });
  const allowedChatChannels = getAllowedChatChannels(room, effectiveAvailableActions);
  const canSendChat =
    connected &&
    Boolean(roomIdInput.trim()) &&
    Boolean(chatMessage.trim()) &&
    allowedChatChannels.includes(chatChannel);
  const targetAction = effectiveAvailableActions.find(isTargetAction) ?? null;
  const canAdvancePhase = effectiveAvailableActions.some(
    (action) => action.type === "NEXT_PHASE",
  );
  const phaseGuide = getPhaseGuide({
    phase: currentPhase,
    role: myRole,
    status: myStatus,
    targetAction,
    canAdvancePhase,
  });

  async function handleEnterGame() {
    const nickname = normalizeNickname(identity.nickname);

    if (!nickname) {
      setConnectionError("플레이어 이름을 입력하세요.");
      return;
    }

    try {
      const canReuseIdentity =
        Boolean(identity.token) &&
        identity.userId !== "demo-user" &&
        normalizeNickname(identity.nickname) === nickname;
      const credentials = canReuseIdentity
        ? {
            userId: identity.userId,
            email: identity.email,
          }
        : buildDemoCredentials(nickname);
      const token = canReuseIdentity
        ? identity.token
        : await createDemoToken({
            userId: credentials.userId,
            email: credentials.email,
          });

      const nextIdentity = {
        nickname,
        userId: credentials.userId,
        email: credentials.email,
        token,
      };

      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      setIdentity(nextIdentity);
      setSocketStatus("connecting");
      setConnectionError("");

      const nextSocket = createSocket(token);
      setSocket(nextSocket);
      socketRef.current = nextSocket;

      appendEventLog({
        title: "플레이 입장",
        kind: "success",
        payload: {
          nickname,
        },
      });
    } catch (error) {
      handleError("입장 실패", error);
    }
  }

  function handleDisconnectSocket() {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocketStatus("disconnected");
    setSocket(null);
  }

  async function handleCreateRoom() {
    if (!isSocketConnected(socketRef.current)) {
      setConnectionError("먼저 이름을 입력하고 입장하세요.");
      return;
    }

    try {
      const created = await createRoom({
        hostUserId: identity.userId,
        name: roomNameInput.trim() || "마피아 게임",
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

      await joinRoom(created.roomId, "방장 자동 참가");
    } catch (error) {
      handleError("방 생성 실패", error);
    }
  }

  async function handleJoinRoom() {
    await joinRoom(roomIdInput.trim(), "방 참가");
  }

  async function joinRoom(targetRoomId: string, logTitle: string) {
    if (!isSocketConnected(socketRef.current)) {
      setConnectionError("먼저 이름을 입력하고 입장하세요.");
      return;
    }

    if (!targetRoomId) {
      setConnectionError("방 코드를 입력하세요.");
      return;
    }

    try {
      const loaded = await getRoom(targetRoomId);
      const currentNickname = normalizeNickname(identity.nickname).toLowerCase();
      const duplicateName = loaded.participants.some(
        (participant) =>
          participant.userId !== identity.userId &&
          normalizeNickname(participant.nickname).toLowerCase() === currentNickname,
      );

      if (duplicateName) {
        setConnectionError("이미 같은 이름의 플레이어가 이 방에 있습니다.");
        setRoom(loaded);
        return;
      }
    } catch {
      // Let the command response show the authoritative server error.
    }

    try {
      const response = await sendCommand({
        type: "JOIN_ROOM",
        gameId: targetRoomId,
        payload: {
          nickname: identity.nickname,
        },
      });

      if (response.type === "COMMAND_ACCEPTED") {
        setRoomIdInput(targetRoomId);
        setConnectionError("");
        appendEventLog({
          title: logTitle,
          kind: "success",
          payload: { roomId: targetRoomId },
        });
        await refreshRoom(targetRoomId);
      }
    } catch (error) {
      handleError(`${logTitle} 실패`, error);
    }
  }

  async function handleToggleReady() {
    if (!roomIdInput.trim()) {
      setConnectionError("방에 먼저 참가하세요.");
      return;
    }

    const next = !isReady;
    setIsReady(next);

    try {
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
    } catch (error) {
      setIsReady((current) => !current);
      handleError("준비 변경 실패", error);
    }
  }

  async function handleStartGame() {
    try {
      await sendCommand({
        type: "START_GAME",
        gameId: roomIdInput.trim(),
        payload: {},
      });
    } catch (error) {
      handleError("게임 시작 실패", error);
    }
  }

  async function handleNextPhase() {
    try {
      await sendCommand({
        type: "NEXT_PHASE",
        gameId: roomIdInput.trim(),
        payload: {},
      });
    } catch (error) {
      handleError("다음 단계 진행 실패", error);
    }
  }

  async function handleTargetPlayerAction(
    actionType: AvailableAction["type"],
    targetUserId: string,
  ) {
    try {
      const response = await sendCommand({
        type: actionType,
        gameId: roomIdInput.trim(),
        payload: {
          targetUserId,
        },
      });

      if (response.type === "COMMAND_ACCEPTED") {
        appendGameNotice({
          kind: "success",
          message: `${findPlayerName(sessionRef.current, roomRef.current, targetUserId)}에게 ${getActionCompleteText(actionType)}`,
        });
      }
    } catch (error) {
      handleError("행동 실패", error);
    }
  }

  async function handleSendChat() {
    if (!roomIdInput.trim()) {
      setConnectionError("방을 먼저 선택하세요.");
      return;
    }

    if (!chatMessage.trim()) {
      return;
    }

    try {
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
    } catch (error) {
      handleError("채팅 전송 실패", error);
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
    const activeSocket = socketRef.current;

    if (!isSocketConnected(activeSocket)) {
      throw new Error("소켓이 연결되지 않았습니다.");
    }

    if (!input.gameId.trim()) {
      throw new Error("방에 먼저 참가하세요.");
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

    activeSocket.emit("command", {
      type: input.type,
      requestId,
      gameId: input.gameId,
      payload: input.payload,
    } satisfies CommandEnvelope);

    const response = await responsePromise;
    appendEventLog({
      title: response.type === "COMMAND_ACCEPTED" ? "요청 성공" : "요청 실패",
      kind: response.type === "COMMAND_ACCEPTED" ? "success" : "error",
      payload: response,
    });

    if (response.type === "COMMAND_REJECTED") {
      if (response.reason === "ROOM_NOT_FOUND") {
        setRoom(null);
      }

      setConnectionError(commandRejectMessage(response.reason));
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

  function appendGameNotice(entry: Omit<GameNotice, "id" | "timestamp">) {
    setGameNotices((current) => [
      {
        id: createRequestId("notice"),
        timestamp: new Date().toISOString(),
        ...entry,
      },
      ...current,
    ].slice(0, 8));
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

  function handleNicknameChange(nextNickname: string) {
    setIdentity((current) => ({
      ...current,
      nickname: nextNickname,
    }));
  }

  return (
    <main className="page play-page">
      <header className="play-topbar">
        <Link className="topbar-brand" href="/">
          <span>Mafia Casefile</span>
        </Link>
        <div className="play-topbar__identity">
          <strong>{connected ? identity.nickname : "입장 전"}</strong>
          <span>{connected ? "접속 중" : "이름을 정해주세요"}</span>
        </div>
        {currentRoomId ? (
          <Link
            className="button button--secondary"
            href={`/games/${encodeURIComponent(currentRoomId)}/timeline`}
          >
            사건 기록
          </Link>
        ) : null}
      </header>

      {connectionError ? <p className="play-alert">{connectionError}</p> : null}

      {viewState === "ENTRY" ? (
        <EntryScreen
          identity={identity}
          debugMode={debugMode}
          isConnecting={socketStatus === "connecting"}
          onEnter={handleEnterGame}
          onNicknameChange={handleNicknameChange}
          onTokenChange={(token) =>
            setIdentity((current) => ({
              ...current,
              token,
            }))
          }
        />
      ) : null}

      {viewState === "ROOM_SETUP" || viewState === "LOBBY" ? (
        <LobbyScreen
          currentUserId={identity.userId}
          isReady={isReady}
          readyDisabled={readyDisabled}
          room={room}
          roomControlsDisabled={roomControlsDisabled}
          roomIdInput={roomIdInput}
          roomMode={roomMode}
          roomNameInput={roomNameInput}
          socketPresent={Boolean(socket)}
          startDisabled={startDisabled}
          viewState={viewState}
          onCreateRoom={handleCreateRoom}
          onDisconnect={handleDisconnectSocket}
          onJoinRoom={handleJoinRoom}
          onRoomIdChange={setRoomIdInput}
          onRoomModeChange={setRoomMode}
          onRoomNameChange={setRoomNameInput}
          onStartGame={handleStartGame}
          onToggleReady={handleToggleReady}
        />
      ) : null}

      {viewState === "GAME_NIGHT" ||
      viewState === "GAME_DAY" ||
      viewState === "GAME_VOTING" ||
      viewState === "GAME_RESULT" ? (
        <GameScreen
          allowedChatChannels={allowedChatChannels}
          canAdvancePhase={canAdvancePhase}
          canSendChat={canSendChat}
          chatChannel={chatChannel}
          chatMessage={chatMessage}
          chatMessages={chatMessages}
          currentTurn={currentTurn}
          currentUserId={identity.userId}
          gameNotices={gameNotices}
          myRole={myRole}
          myStatus={myStatus}
          phaseGuide={phaseGuide}
          players={gamePlayers}
          room={room}
          targetAction={targetAction}
          onChannelChange={setChatChannel}
          onMessageChange={setChatMessage}
          onNextPhase={handleNextPhase}
          onSendChat={handleSendChat}
          onTargetPlayerAction={handleTargetPlayerAction}
        />
      ) : null}

      {debugMode ? (
        <DebugLog eventLog={eventLog} formatEventSummary={formatEventSummary} />
      ) : null}
    </main>
  );
}

function createDemoIdentity(): DemoIdentity {
  const userId = `demo-user-${shortSuffix()}`;

  return {
    userId,
    email: `${userId}@example.com`,
    nickname: "플레이어",
    token: "",
  };
}

function buildDemoCredentials(nickname: string) {
  const normalized = nickname
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalized || `demo-user-${shortSuffix(4)}`;
  const userId = `${base}-${shortSuffix(4)}`;

  return {
    userId,
    email: `${userId}@example.com`,
  };
}

function normalizeNickname(nickname: string) {
  return nickname.trim().replace(/\s+/g, " ");
}

function isSocketConnected(socket: Socket | null): socket is Socket {
  return Boolean(socket?.connected);
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

function readSessionStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(key);
}

function formatEventSummary(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "상세 정보 없음";
  }

  const current = payload as Record<string, unknown>;

  if (typeof current.type === "string") {
    switch (current.type) {
      case "COMMAND_ACCEPTED":
        return "요청 성공";
      case "COMMAND_REJECTED":
        return `요청 실패 · ${typeof current.reason === "string" ? commandRejectMessage(current.reason) : "알 수 없는 이유"}`;
      default:
        break;
    }
  }

  const parts: string[] = [];

  if (typeof current.nickname === "string") {
    parts.push(current.nickname);
  }
  if (typeof current.channel === "string") {
    parts.push(displayChatChannel(current.channel));
  }
  if (typeof current.phase === "string") {
    parts.push(displayPhase(current.phase));
  }
  if (typeof current.toPhase === "string") {
    parts.push(`${displayPhase(current.toPhase)}로 진행`);
  }

  return parts.length > 0 ? parts.join(" · ") : "이벤트 수신";
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

function updateSessionPlayerStatus(
  current: GameSessionView | null,
  userId: string,
  status: string,
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
            status,
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

function findPlayerName(
  session: GameSessionView | null,
  room: RoomView | null,
  userId: string | null,
) {
  if (!userId) {
    return "대상 없음";
  }

  return (
    session?.players.find((player) => player.userId === userId)?.nickname ||
    room?.participants.find((participant) => participant.userId === userId)?.nickname ||
    userId
  );
}

function formatNightResolution(
  event: NightResolvedEvent,
  session: GameSessionView | null,
  room: RoomView | null,
) {
  if (event.killedUserId) {
    return `밤 결과: ${findPlayerName(session, room, event.killedUserId)}이(가) 사망했습니다.`;
  }

  if (event.attackedUserId && event.protectedUserId === event.attackedUserId) {
    return `밤 결과: ${findPlayerName(session, room, event.attackedUserId)}이(가) 습격당했지만 의사의 보호로 살아남았습니다.`;
  }

  if (event.attackedUserId) {
    return "밤 결과: 사망자는 없습니다.";
  }

  return "밤 결과: 아무도 습격하지 않았습니다.";
}

function formatVotingResolution(
  event: VotingResolvedEvent,
  session: GameSessionView | null,
  room: RoomView | null,
) {
  if (event.executedUserId) {
    return `투표 결과: ${findPlayerName(session, room, event.executedUserId)}이(가) 처형되었습니다.`;
  }

  return "투표 결과: 동률로 처형자가 없습니다.";
}

function getActionCompleteText(actionType: AvailableAction["type"]) {
  switch (actionType) {
    case "SELECT_MAFIA_TARGET":
      return "습격 대상을 선택했습니다.";
    case "SELECT_DOCTOR_TARGET":
      return "보호 대상을 선택했습니다.";
    case "SELECT_POLICE_TARGET":
      return "조사를 요청했습니다.";
    case "CAST_VOTE":
      return "투표했습니다.";
    default:
      return "행동을 완료했습니다.";
  }
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
  const otherAlivePlayerIds = alivePlayerIds.filter(
    (userId) => userId !== input.userId,
  );

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
        targetUserIds: otherAlivePlayerIds,
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
        targetUserIds: otherAlivePlayerIds,
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
