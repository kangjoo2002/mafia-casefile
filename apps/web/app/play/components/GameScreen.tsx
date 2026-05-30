"use client";

import type { AvailableAction } from "@mafia-casefile/shared";
import { useEffect, useMemo, useState } from "react";
import type {
  ChatMessageView,
  GameNotice,
  GameSessionPlayerView,
  RoomView,
} from "../../../lib/play-types";
import type { PlayChatChannel } from "../lib/chat";
import {
  displayConnectionStatus,
  displayPlayerStatus,
  displayRole,
  statusClass,
} from "../lib/display";
import { getActionVerb } from "../lib/play-ui";
import { ChatPanel } from "./ChatPanel";

export function GameScreen({
  allowedChatChannels,
  canAdvancePhase,
  canSendChat,
  chatChannel,
  chatMessage,
  chatMessages,
  currentTurn,
  currentUserId,
  gameNotices,
  myRole,
  myStatus,
  phaseEndsAt,
  phaseGuide,
  players,
  room,
  targetAction,
  onChannelChange,
  onMessageChange,
  onNextPhase,
  onSendChat,
  onTargetPlayerAction,
}: {
  allowedChatChannels: PlayChatChannel[];
  canAdvancePhase: boolean;
  canSendChat: boolean;
  chatChannel: PlayChatChannel;
  chatMessage: string;
  chatMessages: ChatMessageView[];
  currentTurn: number;
  currentUserId: string;
  gameNotices: GameNotice[];
  myRole: string;
  myStatus: string;
  phaseEndsAt: string | null;
  phaseGuide: { title: string; description: string };
  players: GameSessionPlayerView[];
  room: RoomView | null;
  targetAction: AvailableAction | null;
  onChannelChange: (channel: PlayChatChannel) => void;
  onMessageChange: (message: string) => void;
  onNextPhase: () => void;
  onSendChat: () => void;
  onTargetPlayerAction: (
    actionType: AvailableAction["type"],
    targetUserId: string,
  ) => void;
}) {
  const remainingSeconds = usePhaseRemainingSeconds(phaseEndsAt);

  return (
    <section className="play-stage play-stage--game">
      <section className="case-board">
        <div className="case-board__header">
          <div>
            <p className="section-kicker">{currentTurn}턴</p>
            <h1>{phaseGuide.title}</h1>
            <p>{phaseGuide.description}</p>
          </div>
          <div className="phase-timer-card">
            <span>자동 전환</span>
            <strong>{formatRemainingTime(remainingSeconds)}</strong>
            <small>{phaseEndsAt ? "서버 타이머 기준" : "대기 중"}</small>
          </div>
          <div className="role-card">
            <span>내 역할</span>
            <strong>{displayRole(myRole)}</strong>
            <small>{displayPlayerStatus(myStatus || "ALIVE")}</small>
          </div>
        </div>

        <div className="suspect-grid">
          {players.map((player) => {
            const isMe = player.userId === currentUserId;
            const isHost = room?.hostUserId === player.userId;
            const canTarget =
              Boolean(targetAction?.targetUserIds?.includes(player.userId)) &&
              player.status === "ALIVE";

            return (
              <article
                key={player.userId}
                className={[
                  "suspect-card",
                  isMe ? "suspect-card--me" : "",
                  player.status === "DEAD" ? "suspect-card--dead" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="suspect-card__top">
                  <strong>{player.nickname || "플레이어"}</strong>
                  <span className={`status-pill ${statusClass(player.status)}`}>
                    {displayPlayerStatus(player.status)}
                  </span>
                </div>
                <div className="player-item__meta">
                  {isMe ? <span className="status-pill status-pill--good">나</span> : null}
                  {isHost ? <span className="status-pill">방장</span> : null}
                  <span className={`status-pill ${statusClass(player.connectionStatus)}`}>
                    {displayConnectionStatus(player.connectionStatus)}
                  </span>
                </div>
                {isMe ? (
                  <p className="meta-value">역할: {displayRole(player.role)}</p>
                ) : null}
                {targetAction ? (
                  <button
                    className="button button--primary"
                    onClick={() =>
                      onTargetPlayerAction(targetAction.type, player.userId)
                    }
                    disabled={!canTarget}
                  >
                    {getActionVerb(targetAction.type)}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="case-actions">
          {canAdvancePhase ? (
            <button className="button button--primary button--xl" onClick={onNextPhase}>
              다음 단계로 진행
            </button>
          ) : null}
          {!targetAction && !canAdvancePhase ? (
            <p className="connection-empty">
              현재 가능한 행동이 없습니다. 타이머가 끝나면 다음 단계로 자동 진행됩니다.
            </p>
          ) : null}
        </div>

        {gameNotices.length > 0 ? (
          <div className="game-notice-list" aria-live="polite">
            {gameNotices.map((notice) => (
              <p
                key={notice.id}
                className={`game-notice game-notice--${notice.kind}`}
              >
                {notice.message}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <ChatPanel
        allowedChatChannels={allowedChatChannels}
        chatChannel={chatChannel}
        chatMessage={chatMessage}
        chatMessages={chatMessages}
        canSendChat={canSendChat}
        currentUserId={currentUserId}
        players={players}
        onChannelChange={onChannelChange}
        onMessageChange={onMessageChange}
        onSendChat={onSendChat}
      />
    </section>
  );
}

function usePhaseRemainingSeconds(phaseEndsAt: string | null) {
  const targetMs = useMemo(() => {
    if (!phaseEndsAt) {
      return null;
    }

    const parsed = Date.parse(phaseEndsAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [phaseEndsAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());

    if (targetMs === null) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

  if (targetMs === null) {
    return null;
  }

  return Math.max(0, Math.ceil((targetMs - now) / 1000));
}

function formatRemainingTime(seconds: number | null) {
  if (seconds === null) {
    return "--:--";
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}
