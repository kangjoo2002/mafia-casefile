import Link from "next/link";

export default function Home() {
  return (
    <main className="page home-page">
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">Mafia Casefile</p>
          <h1>실시간 마피아와 사건 복기를 한 화면에서</h1>
          <p className="hero-copy">
            방을 만들고, 역할을 확인하고, 밤 액션과 투표를 진행하세요.
            모든 핵심 행동은 게임 후 사건 타임라인으로 남습니다.
          </p>
          <div className="home-actions">
            <Link className="button button--primary" href="/play">
              게임 시작
            </Link>
            <Link className="button button--secondary" href="/demo-lab">
              데모 랩
            </Link>
            <Link className="button button--secondary" href="/games/sample-game-id/timeline">
              타임라인 보기
            </Link>
          </div>
        </div>

        <div className="product-preview" aria-label="제품 미리보기">
          <div className="product-preview__bar">
            <span />
            <strong>CASE #042</strong>
          </div>
          <div className="product-preview__grid">
            <div className="preview-panel preview-panel--dark">
              <span>현재 단계</span>
              <strong>낮 토론</strong>
              <p>생존자 4명</p>
            </div>
            <div className="preview-panel">
              <span>내 역할</span>
              <strong>경찰</strong>
              <p>오늘 밤 조사 가능</p>
            </div>
            <div className="preview-timeline">
              <span />
              <p>GameStarted</p>
              <span />
              <p>VoteCasted</p>
              <span />
              <p>PlayerExecuted</p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-note-grid" aria-label="핵심 흐름">
        <article className="note-card">
          <span className="note-label">Lobby</span>
          <strong>초대 코드로 빠른 참가</strong>
          <p>방 생성, 참가, 준비 상태를 한 화면에서 확인합니다.</p>
        </article>
        <article className="note-card">
          <span className="note-label">Play</span>
          <strong>역할별 행동 중심 UI</strong>
          <p>현재 phase에서 가능한 액션만 플레이어 카드에 표시합니다.</p>
        </article>
        <article className="note-card">
          <span className="note-label">Review</span>
          <strong>사건 타임라인 복기</strong>
          <p>게임 종료 후 seq 기준으로 주요 사건을 다시 봅니다.</p>
        </article>
      </section>
    </main>
  );
}
