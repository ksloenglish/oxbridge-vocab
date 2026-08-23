/** Oxbridge Ledger: deterministic exercise construction and scoring rules, separated from the interface. */
import type {
  CollectionCatalogueItem,
  ExerciseSelection,
  ExerciseSnapshot,
  QuestionProgress,
  ReleaseQuestion,
  SegmentMode,
} from "@/types";

export type RandomSource = () => number;

export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function sampleWithoutReplacement<T>(
  items: readonly T[],
  count: number,
  random: RandomSource = Math.random,
): T[] {
  if (!Number.isInteger(count) || count < 0 || count > items.length) {
    throw new Error("The requested question count is not available.");
  }
  return shuffle(items, random).slice(0, count);
}

export function normaliseSegmentMode(
  collection: CollectionCatalogueItem,
  mode: SegmentMode,
): SegmentMode {
  if (mode === "full") return mode;
  return collection.segments.some((segment) => segment.id === mode)
    ? mode
    : collection.segments[0].id;
}

export function getRangeLabel(
  collection: CollectionCatalogueItem,
  mode: SegmentMode,
): string {
  const [first, second] = collection.segments;
  if (mode === "full") {
    return `Words ${first.rangeStart}–${second.rangeEnd} (${first.firstHeadword} – ${second.lastHeadword})`;
  }
  const segment = collection.segments.find((item) => item.id === mode);
  if (!segment) throw new Error("The selected segment is not recognised.");
  return `Words ${segment.rangeStart}–${segment.rangeEnd} (${segment.firstHeadword} – ${segment.lastHeadword})`;
}

export function buildExercise(
  collection: CollectionCatalogueItem,
  mode: SegmentMode,
  count: number,
  questionsBySegment: Record<string, ReleaseQuestion[]>,
  releaseVersion: string,
  random: RandomSource = Math.random,
): ExerciseSnapshot {
  let selected: ReleaseQuestion[];
  if (mode === "full") {
    if (count % 2 !== 0) {
      throw new Error("A full-list exercise needs an even question count.");
    }
    const perSegment = count / 2;
    selected = shuffle(
      collection.segments.flatMap((segment) =>
        sampleWithoutReplacement(
          questionsBySegment[segment.id] ?? [],
          perSegment,
          random,
        ),
      ),
      random,
    );
  } else {
    selected = sampleWithoutReplacement(questionsBySegment[mode] ?? [], count, random);
  }

  if (new Set(selected.map((question) => question.id)).size !== selected.length) {
    throw new Error("The selected exercise contains a duplicate question.");
  }

  const segmentLabel =
    mode === "full"
      ? "Full list"
      : collection.segments.find((segment) => segment.id === mode)?.label ?? "Segment";
  const selection: ExerciseSelection = {
    collectionId: collection.id,
    collectionLabel: collection.label,
    cefrLevel: collection.cefrLevel,
    segmentMode: mode,
    segmentLabel,
    rangeLabel: getRangeLabel(collection, mode),
    requestedCount: count,
  };

  return {
    schemaVersion: 2,
    releaseVersion,
    sessionId: crypto.randomUUID(),
    status: "active",
    selection,
    questions: selected.map((question) => ({
      ...question,
      options: shuffle([question.answer, ...question.distractors], random),
    })),
    questionProgress: selected.map(() => ({
      attemptedOptions: [],
      lastSelectedOption: null,
      resolved: false,
      firstAttemptCorrect: false,
    })),
    currentIndex: 0,
    score: 0,
    elapsedMs: 0,
    savedAtUtc: new Date().toISOString(),
  };
}

export function applyAttempt(
  answer: string,
  progress: QuestionProgress,
  currentScore: number,
  selectedOption: string,
): { progress: QuestionProgress; score: number } {
  if (progress.resolved || progress.attemptedOptions.includes(selectedOption)) {
    return { progress, score: currentScore };
  }
  const correct = selectedOption === answer;
  const firstAttemptCorrect = correct && progress.attemptedOptions.length === 0;
  return {
    progress: {
      attemptedOptions: [...progress.attemptedOptions, selectedOption],
      lastSelectedOption: selectedOption,
      resolved: correct,
      firstAttemptCorrect,
    },
    score: currentScore + (firstAttemptCorrect ? 1 : 0),
  };
}

export function formatActiveTime(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.floor(milliseconds / 10));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export function getPerformanceRemark(percentage: number): string {
  if (percentage === 100) return "Outstanding — perfect score!";
  if (percentage >= 90) return "Excellent work!";
  if (percentage >= 75) return "Very good — keep building momentum.";
  if (percentage >= 60) return "Good effort — review the words and try again.";
  return "Keep practising — every attempt helps.";
}
