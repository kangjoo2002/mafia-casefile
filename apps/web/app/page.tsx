import Link from "next/link";

export default function Home() {
  return (
    <main className="page home-page">
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">Mafia Casefile</p>
          <h1>실시간 마피아 게임의 모든 단서를 기록합니다</h1>
          <p className="hero-copy">
            방을 만들고 역할을 배정받아 밤 액션, 낮 토론, 투표를 진행합니다.
            게임이 끝나면 주요 행동이 사건 타임라인으로 정리됩니다.
          </p>
          <div className="home-actions">
            <Link className="button button--primary" href="/play">
              게임 시작
            </Link>
            <Link className="button button--secondary" href="/demo-lab">
              관찰 모드
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
          <span className="note-label">Play</span>
          <strong>방 생성부터 투표까지</strong>
          <p>참가, 준비, 역할 배정, 밤 액션, 낮 토론을 한 흐름으로 진행합니다.</p>
        </article>
        <article className="note-card">
          <span className="note-label">Observe</span>
          <strong>한 사람이 보는 4인 진행</strong>
          <p>관찰 모드에서 네 플레이어의 연결, 이벤트, 사건 기록을 함께 확인합니다.</p>
        </article>
        <article className="note-card">
          <span className="note-label">Review</span>
          <strong>순서가 보이는 사건 복기</strong>
          <p>게임 종료 후 채팅, 역할 행동, 투표, 처형 흐름을 seq 기준으로 봅니다.</p>
        </article>
      </section>
    </main>
  );
}
