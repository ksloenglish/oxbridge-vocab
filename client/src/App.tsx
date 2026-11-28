/** Oxbridge Ledger: single-state-machine shell joining setup, active exercise, persistence, and results. */
// Oxbridge Ledger behaviour: protect saved local exercise progress behind explicit confirmation.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { SetupView } from "@/components/SetupView";
import { QuestionView } from "@/components/QuestionView";
import { ResultsView } from "@/components/ResultsView";
import { HighScoresView } from "@/components/HighScoresView";
import { FlashcardsView } from "@/components/FlashcardsView";
import { useActiveTimer } from "@/hooks/useActiveTimer";
import { useTrickyWords } from "@/hooks/useTrickyWords";
import { useHighScores } from "@/hooks/useHighScores";
import type { HighScoreOutcome } from "@/hooks/useHighScores";
import { loadCatalogue, loadSegment } from "@/lib/data";
import {
  applyAttempt,
  buildExercise,
  normaliseSegmentMode,
  retryExercise,
} from "@/lib/exercise";
import {
  readSetupPreference,
  resolveSetupPreference,
  writeSetupPreference,
} from "@/lib/setupPreference";
import { buildTrickyWordsExercise } from "@/lib/trickyWords";
import { browserStorage } from "@/lib/trickyWordsStorage";
import type { ExerciseSnapshot, ReleaseCatalogue, SegmentMode } from "@/types";

const STORAGE_KEY = "kslo.oxbridge.savedExercise.v1";

type Screen = "home" | "exercise" | "results" | "high-scores" | "revision";
type RevisionSelection = { collectionId: string; mode: SegmentMode };

/** Each #revision history entry carries its own selection, so Back/Forward/refresh reopen it. */
function revisionSelectionFromHistory(): RevisionSelection | null {
  const state = window.history.state as { revision?: unknown } | null;
  const revision = state?.revision as Partial<RevisionSelection> | undefined;
  return typeof revision?.collectionId === "string" &&
    typeof revision?.mode === "string"
    ? { collectionId: revision.collectionId, mode: revision.mode }
    : null;
}

function screenFromHash(): Screen {
  if (window.location.hash === "#high-scores") return "high-scores";
  if (window.location.hash === "#revision") return "revision";
  return "home";
}
type ConfirmMode = "discard" | "discard-saved" | "quit" | null;
type PreviewMode = "question" | "results" | null;
type PendingStart =
  | { kind: "regular"; collectionId: string; mode: SegmentMode; count: number }
  | { kind: "tricky-words" };

function clearSavedExercise(): void {
  try {
    browserStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // A blocked browser storage must not prevent Quit or navigation.
  }
}

function getPreviewMode(): PreviewMode {
  if (!import.meta.env.DEV) return null;
  const requested = new URLSearchParams(window.location.search).get("preview");
  return requested === "question" || requested === "results" ? requested : null;
}

function readSavedExercise(): ExerciseSnapshot | null {
  try {
    const raw = browserStorage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as ExerciseSnapshot;
    if (
      saved.schemaVersion !== 2 ||
      (saved.kind !== undefined &&
        saved.kind !== "regular" &&
        saved.kind !== "tricky-words") ||
      (saved.highScoreEligible !== undefined &&
        typeof saved.highScoreEligible !== "boolean") ||
      saved.status !== "active" ||
      !Array.isArray(saved.questions) ||
      saved.questions.length === 0 ||
      !Array.isArray(saved.questionProgress) ||
      saved.questionProgress.length !== saved.questions.length ||
      !Number.isInteger(saved.currentIndex) ||
      saved.currentIndex < 0 ||
      saved.currentIndex >= saved.questions.length ||
      !saved.questions.every(
        question =>
          question.optionDefinitions &&
          Array.isArray(question.options) &&
          question.options.every(
            option => typeof question.optionDefinitions[option] === "string"
          )
      )
    ) {
      clearSavedExercise();
      return null;
    }
    return saved;
  } catch {
    clearSavedExercise();
    return null;
  }
}

export default function App() {
  const previewMode = useMemo(() => getPreviewMode(), []);
  const [catalogue, setCatalogue] = useState<ReleaseCatalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(screenFromHash);
  // Null means "use the remembered Home selection", which also serves a refreshed #revision.
  const [revisionSelection, setRevisionSelection] =
    useState<RevisionSelection | null>(revisionSelectionFromHistory);
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;
  const highScoresReturnScreen = useRef<"home" | "results">("home");
  const [exercise, setExercise] = useState<ExerciseSnapshot | null>(null);
  const [savedExercise, setSavedExercise] = useState<ExerciseSnapshot | null>(
    () => readSavedExercise()
  );
  const exerciseRef = useRef(exercise);
  exerciseRef.current = exercise;
  const trickyWords = useTrickyWords();
  const highScores = useHighScores();
  const [newHighScore, setNewHighScore] = useState<HighScoreOutcome | null>(
    null
  );
  const [snapshotWarning, setSnapshotWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const startRequest = useRef(0);

  const saveSnapshot = useCallback((snapshot: ExerciseSnapshot) => {
    try {
      const storage = browserStorage();
      if (!storage) throw new Error("Storage unavailable");
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setSnapshotWarning(null);
    } catch {
      setSnapshotWarning(
        "Exercise progress could not be saved in this browser. Refreshing may lose this session."
      );
    }
  }, []);

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch((error: unknown) => {
        setCatalogueError(
          error instanceof Error
            ? error.message
            : "The release catalogue could not be loaded."
        );
      });
  }, []);

  useEffect(() => {
    if (!catalogue || !previewMode || exercise) return;
    const request = startRequest.current;
    const collection = catalogue.collections[0];
    const segment = collection.segments[0];
    loadSegment(segment.dataFile, catalogue.releaseVersion)
      .then(release => {
        if (request !== startRequest.current) return;
        const preview = buildExercise(
          collection,
          segment.id,
          10,
          { [segment.id]: release.questions },
          catalogue.releaseVersion,
          () => 0.314159
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
            option => option !== preview.questions[2].answer
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
        preview.questionProgress = preview.questionProgress.map(
          (progress, index) => ({
            ...progress,
            attemptedOptions: [preview.questions[index].answer],
            lastSelectedOption: preview.questions[index].answer,
            resolved: true,
            firstAttemptCorrect: index < 8,
          })
        );
        setExercise(preview);
        setScreen("results");
      })
      .catch((error: unknown) => {
        if (request !== startRequest.current) return;
        setCatalogueError(
          error instanceof Error
            ? error.message
            : "The preview data could not be loaded."
        );
      });
  }, [catalogue, exercise, previewMode]);

  const persistElapsed = useCallback(
    (elapsedMs: number) => {
      setExercise(current => {
        if (!current || current.status !== "active" || previewMode)
          return current;
        return { ...current, elapsedMs, savedAtUtc: new Date().toISOString() };
      });
    },
    [previewMode]
  );

  const timer = useActiveTimer(
    screen === "exercise" && exercise?.status === "active",
    exercise?.elapsedMs ?? 0,
    persistElapsed,
    exercise?.sessionId ?? null
  );

  useEffect(() => {
    // Leaving an active exercise through history keeps it resumable, with its time committed.
    const pauseForPageChange = () => {
      startRequest.current += 1;
      setBusy(false);
      const current = exerciseRef.current;
      if (current?.status === "active" && !previewMode) {
        const paused = { ...current, elapsedMs: timer.commit() };
        exerciseRef.current = paused;
        setExercise(paused);
        setSavedExercise(paused);
        saveSnapshot(paused);
      }
      setConfirmMode(null);
      setPendingStart(null);
    };
    const onPageNavigation = () => {
      if (window.location.hash === "#high-scores") {
        if (
          screenRef.current !== "high-scores" &&
          screenRef.current !== "revision"
        ) {
          highScoresReturnScreen.current =
            screenRef.current === "results" ? "results" : "home";
        }
        pauseForPageChange();
        highScores.refresh();
        setScreen("high-scores");
      } else if (window.location.hash === "#revision") {
        // The same return target serves both hash pages, so Results survives either detour.
        if (
          screenRef.current !== "high-scores" &&
          screenRef.current !== "revision"
        ) {
          highScoresReturnScreen.current =
            screenRef.current === "results" ? "results" : "home";
        }
        pauseForPageChange();
        setRevisionSelection(revisionSelectionFromHistory());
        setScreen("revision");
      } else {
        const destination =
          highScoresReturnScreen.current === "results" &&
          exerciseRef.current?.status === "complete"
            ? "results"
            : "home";
        setScreen(current =>
          current === "high-scores" || current === "revision"
            ? destination
            : current
        );
      }
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onPageNavigation);
    window.addEventListener("popstate", onPageNavigation);
    return () => {
      window.removeEventListener("hashchange", onPageNavigation);
      window.removeEventListener("popstate", onPageNavigation);
    };
  }, [timer.commit, highScores.refresh, saveSnapshot, previewMode]);

  const openHighScores = () => {
    highScoresReturnScreen.current =
      screenRef.current === "results" ? "results" : "home";
    startRequest.current += 1;
    setBusy(false);
    highScores.refresh();
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#high-scores`
    );
    setScreen("high-scores");
    window.scrollTo({ top: 0 });
  };

  const closeHighScores = () => {
    highScoresReturnScreen.current = "home";
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );
    setScreen("home");
    window.scrollTo({ top: 0 });
  };

  const openRevision = (collectionId: string, mode: SegmentMode) => {
    highScoresReturnScreen.current = "home";
    startRequest.current += 1;
    setBusy(false);
    setConfirmMode(null);
    setPendingStart(null);
    setRevisionSelection({ collectionId, mode });
    window.history.pushState(
      { revision: { collectionId, mode } },
      "",
      `${window.location.pathname}${window.location.search}#revision`
    );
    setScreen("revision");
    window.scrollTo({ top: 0 });
  };

  const closeRevision = () => {
    highScoresReturnScreen.current = "home";
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );
    setScreen("home");
    window.scrollTo({ top: 0 });
  };

  const handleClearHighScores = () => {
    const result = highScores.clearScores();
    // Keep the completed summary, but stop advertising a rank that was cleared.
    setNewHighScore(null);
    return result;
  };

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
    saveSnapshot(updated);
    setSavedExercise(updated);
  }, [exercise, previewMode, screen, saveSnapshot]);

  const startExercise = useCallback(
    async (collectionId: string, mode: SegmentMode, count: number) => {
      if (!catalogue) return;
      const collection = catalogue.collections.find(
        item => item.id === collectionId
      );
      if (!collection) return;
      const request = ++startRequest.current;
      setBusy(true);
      setCatalogueError(null);
      try {
        const targetSegments =
          mode === "full"
            ? collection.segments
            : collection.segments.filter(segment => segment.id === mode);
        const loaded = await Promise.all(
          targetSegments.map(segment =>
            loadSegment(segment.dataFile, catalogue.releaseVersion)
          )
        );
        if (request !== startRequest.current) return;
        const questionsBySegment = Object.fromEntries(
          loaded.map(segment => [segment.segmentId, segment.questions])
        );
        const created = buildExercise(
          collection,
          mode,
          count,
          questionsBySegment,
          catalogue.releaseVersion
        );
        setNewHighScore(null);
        setExercise(created);
        setSavedExercise(created);
        saveSnapshot(created);
        setScreen("exercise");
        window.scrollTo({ top: 0 });
      } catch (error) {
        if (request !== startRequest.current) return;
        setCatalogueError(
          error instanceof Error
            ? error.message
            : "The exercise could not be prepared."
        );
        setScreen("home");
      } finally {
        if (request === startRequest.current) setBusy(false);
      }
    },
    [catalogue, saveSnapshot]
  );

  const requestStart = (
    collectionId: string,
    mode: SegmentMode,
    count: number
  ) => {
    if (savedExercise) {
      setPendingStart({ kind: "regular", collectionId, mode, count });
      setConfirmMode("discard");
      return;
    }
    void startExercise(collectionId, mode, count);
  };

  const startTrickyWords = () => {
    const current = trickyWords.refresh();
    if (current.entries.length === 0) {
      setScreen("home");
      return;
    }
    const created = buildTrickyWordsExercise(current);
    setNewHighScore(null);
    setExercise(created);
    setSavedExercise(created);
    saveSnapshot(created);
    setScreen("exercise");
    window.scrollTo({ top: 0 });
  };

  const requestTrickyWords = () => {
    if (savedExercise) {
      setPendingStart({ kind: "tricky-words" });
      setConfirmMode("discard");
      return;
    }
    startTrickyWords();
  };

  const handleSelect = useCallback(
    (option: string) => {
      const current = exerciseRef.current;
      if (
        !current ||
        current.status !== "active" ||
        screen !== "exercise" ||
        confirmMode
      )
        return;
      const question = current.questions[current.currentIndex];
      if (!question.options.includes(option)) return;
      const previousProgress = current.questionProgress[current.currentIndex];
      const result = applyAttempt(
        question.answer,
        previousProgress,
        current.score,
        option
      );
      if (result.progress === previousProgress) return;
      const questionProgress = [...current.questionProgress];
      questionProgress[current.currentIndex] = result.progress;
      const updated = {
        ...current,
        questionProgress,
        score: result.score,
        savedAtUtc: new Date().toISOString(),
      };
      // Update once per first answer, before returning control or allowing Quit/refresh.
      // The immediate ref also makes rapid duplicate clicks harmless before a render.
      exerciseRef.current = updated;
      if (!previewMode && previousProgress.attemptedOptions.length === 0) {
        trickyWords.recordFirstAnswer(updated, current.currentIndex);
      }
      setExercise(updated);
      if (!previewMode) saveSnapshot(updated);
    },
    [
      previewMode,
      trickyWords.recordFirstAnswer,
      saveSnapshot,
      screen,
      confirmMode,
    ]
  );

  const handleNext = () => {
    const current = exerciseRef.current;
    if (
      !current ||
      current.status !== "active" ||
      screen !== "exercise" ||
      confirmMode ||
      !current.questionProgress[current.currentIndex].resolved
    )
      return;
    if (current.currentIndex === current.questions.length - 1) {
      const finalElapsed = timer.commit();
      const completed: ExerciseSnapshot = {
        ...current,
        status: "complete",
        elapsedMs: finalElapsed,
      };
      exerciseRef.current = completed;
      setNewHighScore(
        previewMode ? null : highScores.recordCompleted(completed)
      );
      setExercise(completed);
      clearSavedExercise();
      setSavedExercise(null);
      setScreen("results");
    } else {
      const next = { ...current, currentIndex: current.currentIndex + 1 };
      exerciseRef.current = next;
      setExercise(next);
      if (!previewMode) saveSnapshot(next);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleResume = () => {
    if (!savedExercise) return;
    setNewHighScore(null);
    setExercise(savedExercise);
    setScreen("exercise");
    window.scrollTo({ top: 0 });
  };

  const requestDiscardSavedExercise = () => {
    if (!savedExercise) return;
    setConfirmMode("discard-saved");
  };

  const handleConfirm = () => {
    if (confirmMode === "quit" || confirmMode === "discard-saved") {
      clearSavedExercise();
      setSavedExercise(null);
      setExercise(null);
      setScreen("home");
    }
    if (confirmMode === "discard" && pendingStart) {
      clearSavedExercise();
      setSavedExercise(null);
      setExercise(null);
      if (pendingStart.kind === "tricky-words") startTrickyWords();
      else
        void startExercise(
          pendingStart.collectionId,
          pendingStart.mode,
          pendingStart.count
        );
      setPendingStart(null);
    }
    setConfirmMode(null);
  };

  const handleRetry = () => {
    if (!exercise || exercise.status !== "complete") return;
    const restarted = retryExercise(exercise);
    setNewHighScore(null);
    saveSnapshot(restarted);
    setSavedExercise(restarted);
    setExercise(restarted);
    setScreen("exercise");
    window.scrollTo({ top: 0 });
  };

  const handlePlayAgain = () => {
    clearSavedExercise();
    setSavedExercise(null);
    setExercise(null);
    setNewHighScore(null);
    setScreen("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const savedSummary = useMemo(() => {
    if (!savedExercise) return undefined;
    return `${savedExercise.kind === "tricky-words" ? "Retry incorrect questions" : savedExercise.selection.collectionLabel} · question ${Math.min(
      savedExercise.currentIndex + 1,
      savedExercise.questions.length
    )} of ${savedExercise.questions.length}`;
  }, [savedExercise]);

  if (screen === "high-scores") {
    return (
      <div className="app-shell">
        <HighScoresView
          entries={highScores.list.entries}
          warning={highScores.warning}
          onBack={closeHighScores}
          onClear={handleClearHighScores}
        />
      </div>
    );
  }

  // Plain computation (not a hook): it sits after the High scores early return.
  const revisionTarget = (() => {
    if (!catalogue || screen !== "revision") return null;
    const remembered = resolveSetupPreference(catalogue, readSetupPreference());
    const selection = revisionSelection ?? remembered;
    const collection =
      catalogue.collections.find(item => item.id === selection.collectionId) ??
      catalogue.collections[0];
    return {
      collection,
      mode: normaliseSegmentMode(collection, selection.mode),
      count: remembered.count,
    };
  })();

  const switchRevisionToExercise = () => {
    if (revisionTarget) {
      writeSetupPreference({
        collectionId: revisionTarget.collection.id,
        mode: revisionTarget.mode,
        count: revisionTarget.count,
        activity: "exercise",
      });
    }
    closeRevision();
  };

  if (!catalogue) {
    return (
      <main className="loading-page" aria-live="polite">
        <LoaderCircle
          className="loading-spinner"
          size={32}
          aria-hidden="true"
        />
        <strong>Opening the vocabulary folio…</strong>
        {catalogueError && <p role="alert">{catalogueError}</p>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      {screen !== "home" &&
        (trickyWords.warning || snapshotWarning || highScores.warning) && (
          <div className="tricky-words-storage-warning" role="alert">
            <strong>Browser storage notice</strong>
            <span>{trickyWords.warning}</span>
            <span>{snapshotWarning}</span>
            <span>{highScores.warning}</span>
          </div>
        )}
      {screen === "home" && (
        <SetupView
          catalogue={catalogue}
          hasSavedExercise={Boolean(savedExercise)}
          savedSummary={savedSummary}
          busy={busy}
          errorMessage={catalogueError}
          onResume={handleResume}
          onDiscardSavedExercise={requestDiscardSavedExercise}
          onStart={requestStart}
          onRevise={openRevision}
          trickyWordsCount={trickyWords.list.entries.length}
          onPractiseTrickyWords={requestTrickyWords}
          onHighScores={openHighScores}
          storageWarning={
            [trickyWords.warning, snapshotWarning, highScores.warning]
              .filter(Boolean)
              .join(" ") || null
          }
        />
      )}
      {screen === "revision" && revisionTarget && (
        <FlashcardsView
          catalogue={catalogue}
          collection={revisionTarget.collection}
          mode={revisionTarget.mode}
          onBack={closeRevision}
          onExercise={switchRevisionToExercise}
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
        <ResultsView
          exercise={exercise}
          onRetry={handleRetry}
          onPlayAgain={handlePlayAgain}
          trickyWordsRemaining={trickyWords.list.entries.length}
          onPractiseTrickyWords={requestTrickyWords}
          newHighScoreRank={newHighScore?.rank ?? null}
          highScorePersisted={newHighScore?.persisted ?? true}
          onHighScores={openHighScores}
        />
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
              {confirmMode === "quit"
                ? "Quit this exercise?"
                : confirmMode === "discard-saved"
                  ? "Discard saved exercise?"
                  : "Start a new exercise?"}
            </h2>
            <p id="confirm-copy">
              {confirmMode === "quit"
                ? exercise?.kind === "tricky-words"
                  ? "This retry session will end. Questions answered correctly on the first try stay removed; all others remain on your retry list."
                  : "Your unfinished progress will be discarded and cannot be resumed. Incorrect questions already saved will stay on your retry list."
                : confirmMode === "discard-saved"
                  ? "Your unfinished progress will be removed from this device. Your retry list will not be deleted."
                  : "Your saved unfinished exercise will be discarded before the new one begins. Your retry list will be kept."}
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
                {confirmMode === "discard-saved"
                  ? "Keep saved exercise"
                  : "Keep current exercise"}
              </button>
              <button
                className="button button--danger"
                type="button"
                onClick={handleConfirm}
              >
                {confirmMode === "quit"
                  ? exercise?.kind === "tricky-words"
                    ? "Quit retry"
                    : "Quit and discard"
                  : confirmMode === "discard-saved"
                    ? "Discard saved exercise"
                    : "Discard and start"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
