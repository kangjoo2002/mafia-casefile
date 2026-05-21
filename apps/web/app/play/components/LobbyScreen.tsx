import type { RoomView } from "../../../lib/play-types";
import type { PlayViewState } from "../lib/view-state";
import { buildLobbySeats } from "../lib/play-ui";

export function LobbyScreen({
  currentUserId,
  isReady,
  readyDisabled,
  room,
  roomControlsDisabled,
  roomIdInput,
  roomMode,
  roomNameInput,
  socketPresent,
  startDisabled,
  viewState,
  onCreateRoom,
  onDisconnect,
  onJoinRoom,
  onRoomIdChange,
  onRoomModeChange,
  onRoomNameChange,
  onStartGame,
  onToggleReady,
}: {
  currentUserId: string;
  isReady: boolean;
  readyDisabled: boolean;
  room: RoomView | null;
  roomControlsDisabled: boolean;
  roomIdInput: string;
  roomMode: "create" | "join";
  roomNameInput: string;
  socketPresent: boolean;
  startDisabled: boolean;
  viewState: Extract<PlayViewState, "ROOM_SETUP" | "LOBBY">;
  onCreateRoom: () => void;
  onDisconnect: () => void;
  onJoinRoom: () => void;
  onRoomIdChange: (roomId: string) => void;
  onRoomModeChange: (mode: "create" | "join") => void;
  onRoomNameChange: (roomName: string) => void;
  onStartGame: () => void;
  onToggleReady: () => void;
}) {
  return (
    <section className="play-stage play-stage--lobby">
      <aside className="lobby-control">
        <p className="section-kicker">대기실</p>
        <h1>{room ? room.name : "방을 만들거나 참가하세요"}</h1>
        {room ? (
          <div className="room-code-card">
            <span>방 코드</span>
            <strong>{room.roomId}</strong>
          </div>
        ) : null}
        {viewState === "LOBBY" ? (
          <p className="section-note">
            참가 완료. 준비 버튼을 누르고 다른 플레이어를 기다리세요.
          </p>
        ) : null}
        {viewState === "ROOM_SETUP" ? (
          <>
            <div className="mode-switch">
              <button
                className={`button ${roomMode === "create" ? "button--primary" : "button--secondary"}`}
                onClick={() => onRoomModeChange("create")}
              >
                새 방 만들기
              </button>
              <button
                className={`button ${roomMode === "join" ? "button--primary" : "button--secondary"}`}
                onClick={() => onRoomModeChange("join")}
              >
                방 코드로 참가
              </button>
            </div>
            {roomMode === "create" ? (
              <div className="lobby-form">
                <label className="field">
                  <span>방 이름</span>
                  <input
                    value={roomNameInput}
                    onChange={(event) => onRoomNameChange(event.target.value)}
                    placeholder="마피아 게임"
                  />
                </label>
                <button
                  className="button button--primary button--xl"
                  onClick={onCreateRoom}
                  disabled={roomControlsDisabled}
                >
                  방 만들기
                </button>
              </div>
            ) : (
              <div className="lobby-form">
                <label className="field">
                  <span>방 코드</span>
                  <input
                    value={roomIdInput}
                    onChange={(event) => onRoomIdChange(event.target.value)}
                    placeholder="방 코드 입력"
                  />
                </label>
                <button
                  className="button button--primary button--xl"
                  onClick={onJoinRoom}
                  disabled={roomControlsDisabled || !roomIdInput.trim()}
                >
                  참가하기
                </button>
              </div>
            )}
          </>
        ) : null}
        <button
          className="button button--ghost"
          onClick={onDisconnect}
          disabled={!socketPresent}
        >
          나가기
        </button>
      </aside>

      <section className="lobby-board">
        <div className="lobby-board__header">
          <div>
            <p className="section-kicker">참가자</p>
            <h2>{room?.participants.length ?? 0} / {room?.maxPlayers ?? 4}</h2>
          </div>
          <div className="lobby-actions">
            <button
              className="button button--secondary"
              onClick={onToggleReady}
              disabled={readyDisabled}
            >
              {isReady ? "준비 취소" : "준비했습니다"}
            </button>
            <button
              className="button button--primary"
              onClick={onStartGame}
              disabled={startDisabled}
            >
              사건 시작
            </button>
          </div>
        </div>
        <div className="seat-grid">
          {buildLobbySeats(room, currentUserId).map((seat, index) =>
            seat ? (
              <article
                key={seat.userId}
                className={`seat-card ${seat.userId === currentUserId ? "seat-card--me" : ""}`}
              >
                <span className="seat-number">{index + 1}</span>
                <strong>{seat.nickname}</strong>
                <div className="player-item__meta">
                  {seat.userId === room?.hostUserId ? (
                    <span className="status-pill status-pill--good">방장</span>
                  ) : null}
                  <span className={`status-pill ${seat.isReady ? "status-pill--good" : "status-pill--warn"}`}>
                    {seat.isReady ? "준비" : "대기"}
                  </span>
                </div>
              </article>
            ) : (
              <article key={`empty-${index}`} className="seat-card seat-card--empty">
                <span className="seat-number">{index + 1}</span>
                <strong>빈 자리</strong>
                <span className="meta-value">친구를 초대하세요</span>
              </article>
            ),
          )}
        </div>
      </section>
    </section>
  );
}
