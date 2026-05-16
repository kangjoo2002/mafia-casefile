import Link from "next/link";

import {
  extractWinnerTeam,
  getTimelineEventLabel,
  getWinnerTeamLabel,
  parseTimelineResponse,
  sortTimelineEvents,
  type TimelineEvent,
  type TimelineResponse,
} from "../../../../lib/timeline";

type PageProps = {
  params: Promise<{
    gameId: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function TimelinePage({ params }: PageProps) {
  const { gameId: rawGameId } = await params;
  const gameId = rawGameId?.trim() ?? "";

  if (!gameId) {
    return renderErrorPage("gameId가 올바르지 않습니다.", gameId);
  }

  const result = await loadTimeline(gameId);

  if (!result.ok) {
    return renderErrorPage(result.message, gameId);
  }

  const sortedEvents = sortTimelineEvents(result.timeline.events);
  const lastEvent = sortedEvents.at(-1);
  const lastPhase = lastEvent?.phase ?? "아직 종료 기록 없음";
  const lastTurn = lastEvent ? String(lastEvent.turn) : "아직 종료 기록 없음";
  const winnerTeam = getWinnerTeamFromTimeline(sortedEvents);

  return (
    <main className="timeline-page">
      <header className="timeline-header">
        <div className="timeline-header__topline">
          <p className="eyebrow">Mafia Casefile</p>
          <Link className="home-link" href="/">
            홈으로
          </Link>
        </div>
        <h1>게임 사건 타임라인</h1>
        <p className="timeline-subtitle">
          gameId <code>{gameId}</code> 의 복기 화면입니다.
        </p>
      </header>

      <section className="timeline-summary-grid" aria-label="타임라인 요약">
        <article className="summary-card">
          <span className="summary-label">총 사건 수</span>
          <strong className="summary-value">{sortedEvents.length}</strong>
        </article>
        <article className="summary-card">
          <span className="summary-label">마지막 phase</span>
          <strong className="summary-value">{lastPhase}</strong>
        </article>
        <article className="summary-card">
          <span className="summary-label">마지막 turn</span>
          <strong className="summary-value">{lastTurn}</strong>
        </article>
        <article className="summary-card">
          <span className="summary-label">승리 팀</span>
          <strong className="summary-value">{winnerTeam}</strong>
        </article>
      </section>

      {sortedEvents.length === 0 ? (
        <section className="empty-card" aria-live="polite">
          아직 기록된 사건이 없습니다.
        </section>
      ) : (
        <section className="timeline-list" aria-label="사건 목록">
          {sortedEvents.map((event) => (
            <TimelineEventCard key={event.id} event={event} />
          ))}
        </section>
      )}
    </main>
  );
}

async function loadTimeline(
  gameId: string,
): Promise<
  | { ok: true; timeline: TimelineResponse }
  | { ok: false; message: string }
> {
  const apiBaseUrl = normalizeApiBaseUrl(process.env.API_BASE_URL);
  const url = `${apiBaseUrl}/games/${encodeURIComponent(gameId)}/timeline`;

  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      return {
        ok: false,
        message: `타임라인을 불러오지 못했습니다. (HTTP ${response.status})`,
      };
    }

    const parsed = parseTimelineResponse(await response.json());

    if (!parsed) {
      return {
        ok: false,
        message: "타임라인 응답 형식이 올바르지 않습니다.",
      };
    }

    return {
      ok: true,
      timeline: parsed,
    };
  } catch {
    return {
      ok: false,
      message: "타임라인을 불러오지 못했습니다.",
    };
  }
}

function renderErrorPage(message: string, gameId: string) {
  return (
    <main className="timeline-page">
      <header className="timeline-header">
        <div className="timeline-header__topline">
          <p className="eyebrow">Mafia Casefile</p>
          <Link className="home-link" href="/">
            홈으로
          </Link>
        </div>
        <h1>게임 사건 타임라인</h1>
        <p className="timeline-subtitle">
          gameId <code>{gameId || "알 수 없음"}</code> 의 복기 화면입니다.
        </p>
      </header>

      <section className="error-card" aria-live="polite">
        <strong>오류</strong>
        <p>{message}</p>
      </section>
    </main>
  );
}

function TimelineEventCard({ event }: { event: TimelineEvent }) {
  return (
    <article className="timeline-event">
      <div className="timeline-event-header">
        <div>
          <p className="timeline-event-type">
            <span className="timeline-event-seq">#{event.seq}</span>
            <span>{getTimelineEventLabel(event.type)}</span>
          </p>
          <p className="timeline-event-raw-type">{event.type}</p>
        </div>
        <time className="timeline-event-time" dateTime={event.createdAt}>
          {event.createdAt}
        </time>
      </div>

      <dl className="timeline-event-meta">
        <div>
          <dt>turn</dt>
          <dd>{event.turn}</dd>
        </div>
        <div>
          <dt>phase</dt>
          <dd>{event.phase}</dd>
        </div>
        <div>
          <dt>actorUserId</dt>
          <dd>{event.actorUserId ?? "null"}</dd>
        </div>
        <div>
          <dt>requestId</dt>
          <dd>{event.requestId ?? "null"}</dd>
        </div>
      </dl>

      <pre className="payload-block">{formatPayload(event.payload)}</pre>
    </article>
  );
}

function formatPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function getWinnerTeamFromTimeline(events: TimelineEvent[]): string {
  const finishedEvent = [...events].reverse().find((event) => event.type === "GameFinished");
  const winnerTeam = extractWinnerTeam(finishedEvent);

  if (!winnerTeam) {
    return "아직 종료 기록 없음";
  }

  return getWinnerTeamLabel(winnerTeam);
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const fallback = "http://localhost:3001";
  const raw = value?.trim() || fallback;

  return raw.replace(/\/+$/, "");
}
