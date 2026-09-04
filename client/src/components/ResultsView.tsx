/** Oxbridge Ledger: rewarding typographic results folio with a deterministic editorial celebration motif. */
// Oxbridge Ledger Results: retain the two-column review folio; use small scholar-blue/saffron source labels beside headwords.
import { useEffect, useState } from "react";
import { ArrowRight, Check, ClipboardCopy, Clock3, Target, TriangleAlert } from "lucide-react";
import { BrandLockup } from "@/components/BrandLockup";
import { APP_VERSION } from "@/lib/appVersion";
import { formatActiveTime, getPerformanceRemark } from "@/lib/exercise";
import { copyTextToClipboard, formatPractisedWords } from "@/lib/review";
import type { ExerciseSnapshot } from "@/types";

type CopyStatus = "idle" | "copying" | "success" | "error";

export function ResultsView({
  exercise,
  onPlayAgain,
}: {
  exercise: ExerciseSnapshot;
  onPlayAgain: () => void;
}) {
  const total = exercise.questions.length;
  const accuracy = Math.round((exercise.score / total) * 100);
  const highScore = accuracy >= 75;
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (copyStatus !== "success" && copyStatus !== "error") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 3_000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const handleCopy = async () => {
    setCopyStatus("copying");
    try {
      await copyTextToClipboard(formatPractisedWords(exercise));
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <main className="results-page">
      <header className="results-header">
        <BrandLockup compact />
        <span className="release-chip">Version {APP_VERSION}</span>
      </header>

      <section className={`results-hero${highScore ? " is-high-score" : ""}`}>
        {highScore && (
          <div className="results-motif" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        <div className="results-intro">
          <p className="eyebrow">Exercise complete</p>
          <h1>{getPerformanceRemark(accuracy)}</h1>
          <p>
            {exercise.selection.collectionLabel}: {exercise.selection.segmentLabel}
            <br />
            <span>{exercise.selection.rangeLabel}</span>
          </p>
        </div>
        <div className="score-pullquote" aria-label={`Final score ${exercise.score} out of ${total}`}>
          <span>Final score</span>
          <strong>{exercise.score}</strong>
          <small>/ {total}</small>
        </div>
      </section>

      <section className="results-stat-row" aria-label="Exercise statistics">
        <div>
          <Target size={20} aria-hidden="true" />
          <span>First-attempt accuracy</span>
          <strong>{accuracy}%</strong>
        </div>
        <div>
          <Clock3 size={20} aria-hidden="true" />
          <span>Total active time</span>
          <strong>{formatActiveTime(exercise.elapsedMs)}</strong>
        </div>
        <div>
          <span className="stat-index">CEFR</span>
          <span>Vocabulary level</span>
          <strong>{exercise.selection.cefrLevel}</strong>
        </div>
      </section>

      <section className="review-section" aria-labelledby="review-title">
        <div className="review-heading">
          <div>
            <p className="eyebrow">Review index</p>
            <h2 id="review-title">Words from this exercise</h2>
          </div>
          <span>{total} words</span>
        </div>
        <ol className="review-list">
          {exercise.questions.map((question, index) => (
            <li key={question.id}>
              <span className="review-number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <div className="review-wordline">
                  <strong>{question.headword}</strong>
                  {question.partOfSpeech && (
                    <span
                      className="part-of-speech"
                      aria-label={`Part of speech: ${question.partOfSpeech}`}
                    >
                      {question.partOfSpeech}
                    </span>
                  )}
                </div>
                <p>{question.definition}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="results-action">
        <div className="copy-review-action">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void handleCopy()}
            disabled={copyStatus === "copying"}
          >
            {copyStatus === "success" ? (
              <Check size={19} aria-hidden="true" />
            ) : copyStatus === "error" ? (
              <TriangleAlert size={19} aria-hidden="true" />
            ) : (
              <ClipboardCopy size={19} aria-hidden="true" />
            )}
            {copyStatus === "copying"
              ? "Copying…"
              : copyStatus === "success"
                ? `Copied ${total} words`
                : copyStatus === "error"
                  ? "Copy failed — try again"
                  : "Copy words and definitions"}
          </button>
          <span className="copy-status" role="status" aria-live="polite">
            {copyStatus === "success"
              ? "All practised words and definitions were copied."
              : copyStatus === "error"
                ? "The list could not be copied. Please try again."
                : ""}
          </span>
        </div>
        <button className="button button--primary" type="button" onClick={onPlayAgain}>
          Play again
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
