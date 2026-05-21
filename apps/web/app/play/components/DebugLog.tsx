import type { EventLogEntry } from "../../../lib/play-types";

export function DebugLog({
  eventLog,
  formatEventSummary,
}: {
  eventLog: EventLogEntry[];
  formatEventSummary: (payload: unknown) => string;
}) {
  return (
    <details className="panel debug-log-panel">
      <summary className="panel-summary">문제 확인용 로그</summary>
      <div className="panel-body">
        <div className="event-log-list">
          {eventLog.length === 0 ? (
            <p className="connection-empty">이벤트가 아직 없습니다.</p>
          ) : (
            eventLog.map((entry) => (
              <article
                key={entry.id}
                className={`event-log-item event-log-item--${entry.kind}`}
              >
                <div className="event-log-item__header">
                  <p className="event-log-item__name">{entry.title}</p>
                  <div className="event-log-item__meta">
                    <span className="status-pill">{entry.kind}</span>
                    <span className="meta-value">{entry.timestamp}</span>
                  </div>
                </div>
                <p className="event-log-item__summary">
                  {formatEventSummary(entry.payload)}
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
