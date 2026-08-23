/** Oxbridge Ledger: asymmetric reading desk with unambiguous multi-modal feedback and keyboard access. */
import { useEffect } from "react";
import { ArrowRight, Check, Clock3, LogOut, X } from "lucide-react";
import { BrandLockup } from "@/components/BrandLockup";
import { formatActiveTime } from "@/lib/exercise";
import { getSentenceSizeClass } from "@/lib/questionPresentation";
import type { ExerciseSnapshot } from "@/types";
import "../refinement.css";

interface QuestionViewProps {
  exercise: ExerciseSnapshot;
  elapsedMs: number;
  onSelect: (option: string) => void;
  onNext: () => void;
  onQuit: () => void;
}

export function QuestionView({
  exercise,
  elapsedMs,
  onSelect,
  onNext,
  onQuit,
}: QuestionViewProps) {
  const question = exercise.questions[exercise.currentIndex];
  const progress = exercise.questionProgress[exercise.currentIndex];
  const [beforeBlank, afterBlank] = question.question.split("{BLANK}");
  const questionNumber = exercise.currentIndex + 1;
  const total = exercise.questions.length;
  const progressPercent = (questionNumber / total) * 100;
  const hasAttempted = progress.attemptedOptions.length > 0;
  const feedbackOption = progress.lastSelectedOption;
  const feedbackDefinition = feedbackOption
    ? question.optionDefinitions[feedbackOption]
    : null;
  const sentenceSizeClass = getSentenceSizeClass(question.question);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || progress.resolved) return;
      const optionIndex = Number(event.key) - 1;
      if (optionIndex >= 0 && optionIndex < question.options.length) {
        const option = question.options[optionIndex];
        if (!progress.attemptedOptions.includes(option)) onSelect(option);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onSelect, progress.attemptedOptions, progress.resolved, question.options]);

  return (
    <main className="exercise-page">
      <header className="exercise-header">
        <BrandLockup compact />
        <button className="quiet-button" type="button" onClick={onQuit}>
          <LogOut size={17} aria-hidden="true" />
          Quit
        </button>
      </header>

      <section className="exercise-ledger" aria-label="Exercise progress">
        <div className="ledger-metric ledger-metric--progress">
          <span>Question</span>
          <strong>
            {questionNumber} <small>/ {total}</small>
          </strong>
        </div>
        <div className="ledger-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progressPercent / 100})` }} />
        </div>
        <div className="ledger-metric">
          <span>Active time</span>
          <strong className="metric-time">
            <Clock3 size={17} aria-hidden="true" />
            {formatActiveTime(elapsedMs)}
          </strong>
        </div>
        <div className="ledger-metric">
          <span>Score</span>
          <strong>{exercise.score}</strong>
        </div>
      </section>

      <section className="question-stage" aria-labelledby="question-heading">
        <aside className="question-margin-rail" aria-hidden="true">
          <span>Q</span>
          <strong>{String(questionNumber).padStart(2, "0")}</strong>
          <small>Sentence</small>
        </aside>

        <div className="question-workspace">
          <div className="question-copy">
            <p className="eyebrow">
              {exercise.selection.collectionLabel} · {exercise.selection.segmentLabel}
            </p>
            <h1 id="question-heading" className={sentenceSizeClass}>
              {beforeBlank}
              <span className="sentence-blank" aria-label="blank">
                <span>?</span>
              </span>
              {afterBlank}
            </h1>
            <p className="keyboard-hint">Choose an option or press keys 1–4.</p>
          </div>

          <div className="answer-grid" aria-label="Answer options">
            {question.options.map((option, index) => {
              const attempted = progress.attemptedOptions.includes(option);
              const isCorrect = progress.resolved && option === question.answer;
              const isIncorrect = attempted && option !== question.answer;
              const statusClass = isCorrect
                ? " is-correct"
                : isIncorrect
                  ? " is-incorrect"
                  : "";
              return (
                <button
                  className={`answer-option${statusClass}`}
                  type="button"
                  key={`${question.id}-${option}`}
                  disabled={progress.resolved || isIncorrect}
                  onClick={() => onSelect(option)}
                  aria-label={`Option ${index + 1}: ${option}${
                    isCorrect ? ", correct" : isIncorrect ? ", incorrect" : ""
                  }`}
                >
                  <span className="option-key" aria-hidden="true">
                    {index + 1}
                  </span>
                  <strong>{option}</strong>
                  {isCorrect && (
                    <span className="option-status">
                      <Check size={18} strokeWidth={3} aria-hidden="true" />
                      <span className="option-status-text">Correct</span>
                    </span>
                  )}
                  {isIncorrect && (
                    <span className="option-status">
                      <X size={18} strokeWidth={3} aria-hidden="true" />
                      <span className="option-status-text">Try again</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className={`definition-panel${hasAttempted ? " is-visible" : ""}`} aria-live="polite">
            {hasAttempted ? (
              <>
                <div className={`feedback-label${progress.resolved ? " is-correct" : " is-incorrect"}`}>
                  {progress.resolved ? <Check size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
                  <strong>
                    <span className="feedback-text--desktop">
                      {progress.resolved
                        ? progress.firstAttemptCorrect
                          ? "Correct on the first attempt"
                          : "Correct — nicely recovered"
                        : "Not quite — use the definition and try again"}
                    </span>
                    <span className="feedback-text--mobile">
                      {progress.resolved
                        ? progress.firstAttemptCorrect
                          ? "Correct first try"
                          : "Correct — recovered"
                        : "Try again"}
                    </span>
                  </strong>
                </div>
                <div className="definition-copy">
                  <span>
                    {progress.resolved || !feedbackOption
                      ? "Definition"
                      : `Definition of “${feedbackOption}”`}
                  </span>
                  <strong>{feedbackDefinition}</strong>
                </div>
              </>
            ) : (
              <span className="definition-placeholder">
                The selected word’s definition will appear after your first choice.
              </span>
            )}
          </div>

          {progress.resolved && (
            <div className="question-navigation">
              <button className="button button--primary" type="button" onClick={onNext}>
                {questionNumber === total ? "Finish exercise" : "Next question"}
                <ArrowRight size={20} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
