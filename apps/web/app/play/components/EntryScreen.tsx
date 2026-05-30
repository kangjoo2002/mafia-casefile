import type { DemoIdentity } from "../../../lib/play-types";

export function EntryScreen({
  identity,
  debugMode,
  isConnecting,
  onEnter,
  onNicknameChange,
  onTokenChange,
}: {
  identity: DemoIdentity;
  debugMode: boolean;
  isConnecting: boolean;
  onEnter: () => void;
  onNicknameChange: (nickname: string) => void;
  onTokenChange: (token: string) => void;
}) {
  return (
    <section className="play-stage play-stage--entry">
      <div className="entry-card">
        <p className="section-kicker">Mafia Casefile</p>
        <h1>플레이어 프로필</h1>
        <p className="hero-copy">
          표시될 이름을 정하면 로비로 이동합니다. 방을 만들거나 초대 코드를
          입력해 바로 참가할 수 있습니다.
        </p>
        <label className="field entry-name-field">
          <span>플레이어 이름</span>
          <input
            value={identity.nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="예: 민수"
            autoFocus
          />
        </label>
        <button
          className="button button--primary button--xl"
          onClick={onEnter}
          disabled={isConnecting}
        >
          {isConnecting ? "연결 중..." : "로비로 이동"}
        </button>
        {debugMode ? (
          <details className="debug-details">
            <summary>고급: 데모 토큰</summary>
            <textarea
              value={identity.token}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder="로컬 데모 토큰"
            />
          </details>
        ) : null}
      </div>
    </section>
  );
}
