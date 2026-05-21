import type { AvailableAction } from "@mafia-casefile/shared";
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
  return (
    <section className="play-stage play-stage--game">
      <section className="case-board">
        <div className="case-board__header">
          <div>
            <p className="section-kicker">{currentTurn}턴</p>
            <h1>{phaseGuide.title}</h1>
            <p>{phaseGuide.description}</p>
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
              지금은 기다리는 시간입니다. 가능한 행동이 생기면 여기에 표시됩니다.
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
