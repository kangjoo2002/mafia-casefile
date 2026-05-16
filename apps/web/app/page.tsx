import type { GamePhase } from "@mafia-casefile/shared";

export default function Home() {
  const currentPhase: GamePhase = "WAITING";

  return (
    <main className="page" data-phase={currentPhase}>
      <p className="eyebrow">Mafia Casefile</p>
      <h1>실시간 마피아 게임 서버 프로젝트</h1>
      <p>
        이 화면은 Mafia Casefile Web 앱의 최소 실행 기반입니다.
      </p>
    </main>
  );
}
