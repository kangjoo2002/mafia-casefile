import type { ChatMessageView, GameSessionPlayerView } from "../../../lib/play-types";
import type { PlayChatChannel } from "../lib/chat";
import { displayChatChannel } from "../lib/display";

export function ChatPanel({
  allowedChatChannels,
  chatChannel,
  chatMessage,
  chatMessages,
  canSendChat,
  currentUserId,
  players,
  onChannelChange,
  onMessageChange,
  onSendChat,
}: {
  allowedChatChannels: PlayChatChannel[];
  chatChannel: PlayChatChannel;
  chatMessage: string;
  chatMessages: ChatMessageView[];
  canSendChat: boolean;
  currentUserId: string;
  players: GameSessionPlayerView[];
  onChannelChange: (channel: PlayChatChannel) => void;
  onMessageChange: (message: string) => void;
  onSendChat: () => void;
}) {
  return (
    <aside className="case-chat">
      <div className="case-chat__header">
        <div>
          <p className="section-kicker">채팅</p>
          <h2>
            {allowedChatChannels.includes(chatChannel)
              ? displayChatChannel(chatChannel)
              : "채팅 불가"}
          </h2>
        </div>
        <div className="chat-tabs">
          {allowedChatChannels.length > 0 ? (
            allowedChatChannels.map((channel) => (
              <button
                key={channel}
                className={`button ${chatChannel === channel ? "button--primary" : "button--secondary"}`}
                onClick={() => onChannelChange(channel)}
              >
                {displayChatChannel(channel)}
              </button>
            ))
          ) : (
            <span className="connection-empty">지금은 채팅할 수 없습니다</span>
          )}
        </div>
      </div>
      <div className="chat-list">
        {chatMessages.length === 0 ? (
          <p className="connection-empty">아직 채팅이 없습니다.</p>
        ) : (
          chatMessages.map((message) => {
            const senderLabel =
              message.senderUserId === currentUserId
                ? "나"
                : getPlayerLabel(players, message.senderUserId);

            return (
              <article key={message.id} className="chat-message">
                <div className="chat-message__header">
                  <p className="chat-message__name">{senderLabel}</p>
                  <span className={`channel-pill channel-pill--${message.channel}`}>
                    {displayChatChannel(message.channel)}
                  </span>
                </div>
                <p className="chat-message__body">{message.message}</p>
              </article>
            );
          })
        )}
      </div>
      <div className="case-chat__composer">
        <textarea
          value={chatMessage}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder="대화 내용을 입력하세요"
        />
        <button
          className="button button--primary"
          onClick={onSendChat}
          disabled={!canSendChat}
        >
          보내기
        </button>
      </div>
    </aside>
  );
}

function getPlayerLabel(
  players: GameSessionPlayerView[],
  userId: string | null | undefined,
) {
  if (!userId) {
    return "시스템";
  }

  return players.find((player) => player.userId === userId)?.nickname ?? "플레이어";
}
