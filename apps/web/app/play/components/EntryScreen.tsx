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
        <h1>이름만 정하면 바로 시작합니다</h1>
        <p className="hero-copy">
          4명이 같은 방에 들어와 준비하면 사건이 시작됩니다. 복잡한 설정은
          뒤에서 자동으로 처리됩니다.
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
          {isConnecting ? "입장 중..." : "입장하기"}
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
