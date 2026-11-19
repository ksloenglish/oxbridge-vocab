/** Oxbridge Ledger: browser-local achievements in a responsive ranked folio. */
import { ArrowLeft, Trophy } from "lucide-react";
import { BrandLockup } from "@/components/BrandLockup";
import { APP_VERSION } from "@/lib/appVersion";
import { formatActiveTime } from "@/lib/exercise";
import { HIGH_SCORE_COLLECTIONS } from "@/lib/highScores";
import type { HighScoreEntry } from "@/lib/highScores";

interface HighScoresViewProps {
  entries: HighScoreEntry[];
  warning: string | null;
  onBack: () => void;
}

const completionDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Hong_Kong",
});

export function HighScoresView({
  entries,
  warning,
  onBack,
}: HighScoresViewProps) {
  // Ranking and persistence belong to the high-score library and completion flow,
  // never to rendering this page. Only display the supplied ranked top ten.
  const topTen = entries.slice(0, 10);

  return (
    <main className="high-scores-page">
      <header className="high-scores-header">
        <BrandLockup compact />
        <button
          className="button high-scores-back"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Back to Home
        </button>
      </header>

      <section
        className="high-scores-folio"
        aria-labelledby="high-scores-title"
      >
        <div className="high-scores-intro">
          <div>
            <p className="high-scores-kicker">Personal ledger · Top 10</p>
            <h1 id="high-scores-title">High scores</h1>
            <p className="high-scores-description">
              Your best fresh exercises, kept in this browser. Aim higher, learn
              more, and make your next first attempt count.
            </p>
          </div>
          <Trophy
            className="high-scores-intro-icon"
            size={54}
            aria-hidden="true"
          />
        </div>

        {warning && (
          <aside
            className="high-scores-warning"
            role="status"
            aria-live="polite"
          >
            <strong>Browser storage notice</strong>
            <p>{warning}</p>
          </aside>
        )}

        <section
          className="high-scores-rules"
          aria-labelledby="high-scores-rules-title"
        >
          <h2 id="high-scores-rules-title">How the ranking works</h2>
          <p>
            <strong>
              Higher level → more questions → better first-attempt accuracy →
              shorter active time.
            </strong>
          </p>
          <p>
            Levels:{" "}
            <strong>
              C2 &gt; C1 &gt; Oxford 5000 B2 &gt; Oxford 3000 B2 &gt; B1 &gt; A2
              &gt; A1
            </strong>
            .
          </p>
          <p className="high-scores-local-note">
            New completed exercises only — <strong>no retries</strong>. Your top
            10 are saved in this browser; clearing browser data removes them.
          </p>
        </section>

        {topTen.length > 0 ? (
          <section
            className="high-scores-ranking"
            aria-labelledby="high-scores-ranking-title"
          >
            <div className="high-scores-list-heading">
              <h2 id="high-scores-ranking-title">Your ranked results</h2>
              <span>{topTen.length} / 10 places</span>
            </div>
            <ol className="high-scores-list">
              {topTen.map((entry, index) => {
                const collection = HIGH_SCORE_COLLECTIONS[entry.collectionId];
                const accuracy = Math.round(
                  (entry.correctFirst / entry.questionCount) * 100
                );

                return (
                  <li
                    className={`high-scores-entry${index === 0 ? " high-scores-entry--first" : ""}`}
                    key={entry.sessionId}
                  >
                    <span
                      className="high-scores-rank"
                      aria-label={`Rank ${index + 1}`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="high-scores-source">
                      <div className="high-scores-collection">
                        <span
                          className="high-scores-level"
                          aria-label={`CEFR level ${collection.cefrLevel}`}
                        >
                          {collection.cefrLevel}
                        </span>
                        <h3>{collection.label}</h3>
                      </div>
                      <p className="high-scores-segment">
                        {entry.segmentLabel}
                      </p>
                      <p className="high-scores-range">{entry.rangeLabel}</p>
                    </div>
                    <dl className="high-scores-metrics">
                      <div>
                        <dt>Questions</dt>
                        <dd>{entry.questionCount}</dd>
                      </div>
                      <div>
                        <dt>Correct first</dt>
                        <dd>
                          {entry.correctFirst}
                          <small> / {entry.questionCount}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Accuracy</dt>
                        <dd>
                          {accuracy}
                          <small>%</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Active time</dt>
                        <dd className="high-scores-time">
                          {formatActiveTime(entry.elapsedMs)}
                        </dd>
                      </div>
                    </dl>
                    <div className="high-scores-date">
                      <span>Completed</span>
                      <time dateTime={entry.completedAtUtc}>
                        {completionDate.format(new Date(entry.completedAtUtc))}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <section
            className="high-scores-empty"
            aria-labelledby="high-scores-empty-title"
          >
            <span className="high-scores-empty-mark" aria-hidden="true">
              <Trophy size={28} />
            </span>
            <h2 id="high-scores-empty-title">
              Your next exercise could be the first.
            </h2>
            <p>
              No qualifying results yet. Go back to Home, choose a vocabulary
              collection and finish a fresh regular exercise to open your
              ledger. Retries are for learning, not ranking.
            </p>
            <button
              className="button high-scores-back"
              type="button"
              onClick={onBack}
            >
              <ArrowLeft size={18} aria-hidden="true" />
              Back to Home
            </button>
          </section>
        )}
      </section>

      <footer className="high-scores-footer">
        <span>Version {APP_VERSION}</span>
        <span>
          © {new Date().getFullYear()} K S Lo English. All Rights Reserved.
        </span>
      </footer>
    </main>
  );
}
