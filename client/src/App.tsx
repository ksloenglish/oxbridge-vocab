/** Oxbridge Ledger: single-state-machine shell joining setup, active exercise, persistence, and results. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { SetupView } from "@/components/SetupView";
import { QuestionView } from "@/components/QuestionView";
import { ResultsView } from "@/components/ResultsView";
import { useActiveTimer } from "@/hooks/useActiveTimer";
import { loadCatalogue, loadSegment } from "@/lib/data";
import { applyAttempt, buildExercise } from "@/lib/exercise";
import type {
  ExerciseSnapshot,
  ReleaseCatalogue,
  SegmentMode,
} from "@/types";

const STORAGE_KEY = "kslo.oxbridge.savedExercise.v1";

type Screen = "home" | "exercise" | "results";
type ConfirmMode = "discard" | "quit" | null;
type PreviewMode = "question" | "results" | null;

function getPreviewMode(): PreviewMode {
  if (!import.meta.env.DEV) return null;
  const requested = new URLSearchParams(window.location.search).get("preview");
  return requested === "question" || requested === "results" ? requested : null;
}

function readSavedExercise(): ExerciseSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as ExerciseSnapshot;
    if (
      saved.schemaVersion !== 2 ||
      saved.status !== "active" ||
      !Array.isArray(saved.questions) ||
      saved.questions.length === 0 ||
      saved.questionProgress.length !== saved.questions.length ||
      !saved.questions.every(
        (question) =>
          question.optionDefinitions &&
          question.options.every(
            (option) => typeof question.optionDefinitions[option] === "string",
          ),
      )
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return saved;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export default function App() {
  const previewMode = useMemo(() => getPreviewMode(), []);
  const [catalogue, setCatalogue] = useState<ReleaseCatalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [exercise, setExercise] = useState<ExerciseSnapshot | null>(null);
  const [savedExercise, setSavedExercise] = useState<ExerciseSnapshot | null>(() =>
    readSavedExercise(),
  );
  const [busy, setBusy] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [pendingStart, setPendingStart] = useState<{
    collectionId: string;
    mode: SegmentMode;
    count: number;
  } | null>(null);

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch((error: unknown) => {
        setCatalogueError(
          error instanceof Error ? error.message : "The release catalogue could not be loaded.",
        );
      });
  }, []);

  useEffect(() => {
    if (!catalogue || !previewMode || exercise) return;
    const collection = catalogue.collections[0];
    const segment = collection.segments[0];
    loadSegment(segment.dataFile, catalogue.releaseVersion)
      .then((release) => {
        const preview = buildExercise(
          collection,
          segment.id,
          10,
          { [segment.id]: release.questions },
          catalogue.releaseVersion,
          () => 0.314159,
        );
        if (previewMode === "question") {
          preview.currentIndex = 2;
          preview.score = 2;
          preview.questionProgress[0] = {
            attemptedOptions: [preview.questions[0].answer],
            lastSelectedOption: preview.questions[0].answer,
            resolved: true,
            firstAttemptCorrect: true,
          };
          preview.questionProgress[1] = {
            attemptedOptions: [preview.questions[1].answer],
            lastSelectedOption: preview.questions[1].answer,
            resolved: true,
            firstAttemptCorrect: true,
          };
          const wrongOption = preview.questions[2].options.find(
            (option) => option !== preview.questions[2].answer,
          );
          preview.questionProgress[2] = {
            attemptedOptions: wrongOption ? [wrongOption] : [],
            lastSelectedOption: wrongOption ?? null,
            resolved: false,
            firstAttemptCorrect: false,
          };
          preview.elapsedMs = 268_350;
          setExercise(preview);
          setScreen("exercise");
          return;
        }
        preview.status = "complete";
        preview.score = 8;
        preview.elapsedMs = 268_350;
        preview.questionProgress = preview.questionProgress.map((progress, index) => ({
          ...progress,
          attemptedOptions: [preview.questions[index].answer],
          lastSelectedOption: preview.questions[index].answer,
          resolved: true,
          firstAttemptCorrect: index < 8,
        }));
        setExercise(preview);
        setScreen("results");
      })
      .catch((error: unknown) => {
        setCatalogueError(
          error instanceof Error ? error.message : "The preview data could not be loaded.",
        );
      });
  }, [catalogue, exercise, previewMode]);

  const persistElapsed = useCallback(
    (elapsedMs: number) => {
      setExercise((current) => {
        if (!current || current.status !== "active" || previewMode) return current;
        const updated = { ...current, elapsedMs, savedAtUtc: new Date().toISOString() };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setSavedExercise(updated);
        return updated;
      });
    },
    [previewMode],
  );

  const timer = useActiveTimer(
    screen === "exercise" && exercise?.status === "active",
    exercise?.elapsedMs ?? 0,
    persistElapsed,
    exercise?.sessionId ?? null,
  );

  useEffect(() => {
    if (
      !exercise ||
      exercise.status !== "active" ||
      screen !== "exercise" ||
      previewMode
    ) {
      return;
    }
    const updated = { ...exercise, savedAtUtc: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSavedExercise(updated);
  }, [exercise, previewMode, screen]);

  const startExercise = useCallback(
    async (collectionId: string, mode: SegmentMode, count: number) => {
      if (!catalogue) return;
      const collection = catalogue.collections.find((item) => item.id === collectionId);
      if (!collection) return;
      setBusy(true);
      setCatalogueError(null);
      try {
        const targetSegments =
          mode === "full"
            ? collection.segments
            : collection.segments.filter((segment) => segment.id === mode);
        const loaded = await Promise.all(
          targetSegments.map((segment) =>
            loadSegment(segment.dataFile, catalogue.releaseVersion),
          ),
        );
        const questionsBySegment = Object.fromEntries(
          loaded.map((segment) => [segment.segmentId, segment.questions]),
        );
        const created = buildExercise(
          collection,
          mode,
          count,
          questionsBySegment,
          catalogue.releaseVersion,
        );
        setExercise(created);
        setSavedExercise(created);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(created));
        setScreen("exercise");
        window.scrollTo({ top: 0 });
      } catch (error) {
        setCatalogueError(
          error instanceof Error ? error.message : "The exercise could not be prepared.",
        );
        setScreen("home");
      } finally {
        setBusy(false);
      }
    },
    [catalogue],
  );

  const requestStart = (collectionId: string, mode: SegmentMode, count: number) => {
    if (savedExercise) {
      setPendingStart({ collectionId, mode, count });
      setConfirmMode("discard");
      return;
    }
    void startExercise(collectionId, mode, count);
  };

  const handleSelect = useCallback((option: string) => {
    setExercise((current) => {
      if (!current) return current;
      const question = current.questions[current.currentIndex];
      const previousProgress = current.questionProgress[current.currentIndex];
      const result = applyAttempt(question.answer, previousProgress, current.score, option);
      if (result.progress === previousProgress) return current;
      const questionProgress = [...current.questionProgress];
      questionProgress[current.currentIndex] = result.progress;
      return {
        ...current,
        questionProgress,
        score: result.score,
        savedAtUtc: new Date().toISOString(),
      };
    });
  }, []);

  const handleNext = () => {
    setExercise((current) => {
      if (!current) return current;
      if (current.currentIndex === current.questions.length - 1) {
        const finalElapsed = timer.commit();
        window.localStorage.removeItem(STORAGE_KEY);
        setSavedExercise(null);
        setScreen("results");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return { ...current, status: "complete", elapsedMs: finalElapsed };
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      return { ...current, currentIndex: current.currentIndex + 1 };
    });
  };

  const handleResume = () => {
    if (!savedExercise) return;
    setExercise(savedExercise);
    setScreen("exercise");
    window.scrollTo({ top: 0 });
  };

  const handleConfirm = () => {
    if (confirmMode === "quit") {
      window.localStorage.removeItem(STORAGE_KEY);
      setSavedExercise(null);
      setExercise(null);
      setScreen("home");
    }
    if (confirmMode === "discard" && pendingStart) {
      window.localStorage.removeItem(STORAGE_KEY);
      setSavedExercise(null);
      void startExercise(pendingStart.collectionId, pendingStart.mode, pendingStart.count);
      setPendingStart(null);
    }
    setConfirmMode(null);
  };

  const handlePlayAgain = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSavedExercise(null);
    setExercise(null);
    setScreen("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const savedSummary = useMemo(() => {
    if (!savedExercise) return undefined;
    return `${savedExercise.selection.collectionLabel} · question ${Math.min(
      savedExercise.currentIndex + 1,
      savedExercise.questions.length,
    )} of ${savedExercise.questions.length}`;
  }, [savedExercise]);

  if (!catalogue) {
    return (
      <main className="loading-page" aria-live="polite">
        <LoaderCircle className="loading-spinner" size={32} aria-hidden="true" />
        <strong>Opening the vocabulary folio…</strong>
        {catalogueError && <p role="alert">{catalogueError}</p>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      {screen === "home" && (
        <SetupView
          catalogue={catalogue}
          hasSavedExercise={Boolean(savedExercise)}
          savedSummary={savedSummary}
          busy={busy}
          errorMessage={catalogueError}
          onResume={handleResume}
          onStart={requestStart}
        />
      )}
      {screen === "exercise" && exercise && (
        <QuestionView
          exercise={exercise}
          elapsedMs={timer.elapsedMs}
          onSelect={handleSelect}
          onNext={handleNext}
          onQuit={() => setConfirmMode("quit")}
        />
      )}
      {screen === "results" && exercise && (
        <ResultsView exercise={exercise} onPlayAgain={handlePlayAgain} />
      )}

      {confirmMode && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-copy"
          >
            <span className="dialog-icon" aria-hidden="true">
              <AlertTriangle size={22} />
            </span>
            <p className="eyebrow">Please confirm</p>
            <h2 id="confirm-title">
              {confirmMode === "quit" ? "Quit this exercise?" : "Start a new exercise?"}
            </h2>
            <p id="confirm-copy">
              {confirmMode === "quit"
                ? "Your unfinished progress will be discarded and cannot be resumed."
                : "Your saved unfinished exercise will be discarded before the new one begins."}
            </p>
            <div className="dialog-actions">
              <button
                className="button button--secondary"
                type="button"
                autoFocus
                onClick={() => {
                  setConfirmMode(null);
                  setPendingStart(null);
                }}
              >
                Keep current exercise
              </button>
              <button className="button button--danger" type="button" onClick={handleConfirm}>
                {confirmMode === "quit" ? "Quit and discard" : "Discard and start"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
