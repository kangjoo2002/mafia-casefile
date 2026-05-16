import type { GamePhase } from "@mafia-casefile/shared";
import Link from "next/link";

export default function Home() {
  const currentPhase: GamePhase = "WAITING";

  return (
    <main className="page" data-phase={currentPhase}>
      <p className="eyebrow">Mafia Casefile</p>
      <h1>실시간 마피아 게임 서버 프로젝트</h1>
      <p>
        이 화면은 Mafia Casefile Web 앱의 최소 실행 기반입니다.
      </p>
      <p>
        게임 종료 후 <code>/games/sample-game-id/timeline</code>에서 사건
        타임라인을 확인할 수 있습니다.
      </p>
      <p>
        <Link className="text-link" href="/games/sample-game-id/timeline">
          복기 페이지 예시 보기
        </Link>
      </p>
    </main>
  );
}
