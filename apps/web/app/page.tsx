import Link from "next/link";

export default function Home() {
  return (
    <main className="page home-page">
      <section className="hero-card">
        <p className="eyebrow">Mafia Casefile</p>
        <h1>4명이 브라우저에서 바로 플레이하는 마피아 데모</h1>
        <p className="hero-copy">
          `/play`에서 데모 토큰을 만들고, 방을 생성/참가한 뒤 ready,
          start, 밤 액션, 낮 채팅, 투표까지 이어서 진행할 수 있습니다.
        </p>
        <div className="home-actions">
          <Link className="button button--primary" href="/play">
            플레이 화면 열기
          </Link>
          <Link className="button button--secondary" href="/games/sample-game-id/timeline">
            복기 페이지 예시
          </Link>
        </div>
      </section>

      <section className="home-note-grid" aria-label="로컬 실행 안내">
        <article className="note-card">
          <span className="note-label">API</span>
          <strong>http://localhost:3001</strong>
          <p>백엔드와 Socket.IO 서버가 실행되는 주소입니다.</p>
        </article>
        <article className="note-card">
          <span className="note-label">Web</span>
          <strong>http://localhost:3000</strong>
          <p>여기서 데모 UI와 타임라인 페이지를 확인합니다.</p>
        </article>
        <article className="note-card">
          <span className="note-label">Demo token</span>
          <strong>로컬 전용</strong>
          <p>/api/demo-token으로 JWT를 발급받아 연결할 수 있습니다.</p>
        </article>
      </section>
    </main>
  );
}
