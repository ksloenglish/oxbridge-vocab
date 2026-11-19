/** Compact browser-only results: no questions, definitions or answer histories are retained. */
import type { ExerciseSnapshot } from "../types";
import { QUESTION_COUNTS } from "./setupPreference";

export interface HighScoreEntry {
  sessionId: string;
  collectionId: string;
  questionCount: number;
  correctFirst: number;
  elapsedMs: number;
  completedAtUtc: string;
  segmentLabel: string;
  rangeLabel: string;
}

export interface HighScoresList {
  schemaVersion: 1;
  entries: HighScoreEntry[];
}

export const HIGH_SCORES_STORAGE_KEY = "kslo.oxbridge.highScores.v1";
export const MAX_HIGH_SCORES = 10;
export const HIGH_SCORE_COLLECTIONS: Record<
  string,
  { label: string; cefrLevel: string; rank: number }
> = {
  "cambridge-c2": { label: "Cambridge C2", cefrLevel: "C2", rank: 7 },
  "ox5000-c1": { label: "Oxford 5000 C1", cefrLevel: "C1", rank: 6 },
  "ox5000-b2": { label: "Oxford 5000 B2", cefrLevel: "B2", rank: 5 },
  "ox3000-b2": { label: "Oxford 3000 B2", cefrLevel: "B2", rank: 4 },
  "ox3000-b1": { label: "Oxford 3000 B1", cefrLevel: "B1", rank: 3 },
  "ox3000-a2": { label: "Oxford 3000 A2", cefrLevel: "A2", rank: 2 },
  "ox3000-a1": { label: "Oxford 3000 A1", cefrLevel: "A1", rank: 1 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function owns(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isCollection(value: unknown): value is string {
  return typeof value === "string" && owns(HIGH_SCORE_COLLECTIONS, value);
}

/** Reject local dates, offsets and Date.parse's permissive impossible-date rollovers. */
function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value
  );
  if (!match) return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`
  );
}

function isElapsed(value: unknown): value is number {
  // Zero is possible for an exceptionally rapid client completion; keep fractional ms.
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function readEntry(value: unknown): HighScoreEntry | null {
  if (!isRecord(value)) return null;
  const fields = [
    "sessionId",
    "collectionId",
    "questionCount",
    "correctFirst",
    "elapsedMs",
    "completedAtUtc",
    "segmentLabel",
    "rangeLabel",
  ];
  if (!fields.every(field => owns(value, field))) return null;
  if (
    !isText(value.sessionId, 128) ||
    !isCollection(value.collectionId) ||
    typeof value.questionCount !== "number" ||
    !Number.isInteger(value.questionCount) ||
    value.questionCount < 1 ||
    value.questionCount > 100 ||
    typeof value.correctFirst !== "number" ||
    !Number.isInteger(value.correctFirst) ||
    value.correctFirst < 0 ||
    value.correctFirst > value.questionCount ||
    !isElapsed(value.elapsedMs) ||
    !isUtcTimestamp(value.completedAtUtc) ||
    !isText(value.segmentLabel, 128) ||
    !isText(value.rangeLabel, 512)
  )
    return null;
  // Explicit projection removes transient, unknown and private fields.
  return {
    sessionId: value.sessionId,
    collectionId: value.collectionId,
    questionCount: value.questionCount,
    correctFirst: value.correctFirst,
    elapsedMs: value.elapsedMs,
    completedAtUtc: value.completedAtUtc,
    segmentLabel: value.segmentLabel,
    rangeLabel: value.rangeLabel,
  };
}

export function emptyHighScores(): HighScoresList {
  return { schemaVersion: 1, entries: [] };
}

/** A negative result puts a before b; only final exact ties use completion/session. */
export function compareHighScores(
  a: HighScoreEntry,
  b: HighScoreEntry
): number {
  const aRank = isCollection(a.collectionId)
    ? HIGH_SCORE_COLLECTIONS[a.collectionId].rank
    : 0;
  const bRank = isCollection(b.collectionId)
    ? HIGH_SCORE_COLLECTIONS[b.collectionId].rank
    : 0;
  return (
    bRank - aRank ||
    b.questionCount - a.questionCount ||
    // Bounded integer cross-products compare rational accuracy without rounding.
    b.correctFirst * a.questionCount - a.correctFirst * b.questionCount ||
    a.elapsedMs - b.elapsedMs ||
    Date.parse(a.completedAtUtc) - Date.parse(b.completedAtUtc) ||
    (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
  );
}

function normaliseList(value: unknown): HighScoresList {
  if (
    !isRecord(value) ||
    !owns(value, "schemaVersion") ||
    value.schemaVersion !== 1 ||
    !owns(value, "entries") ||
    !Array.isArray(value.entries)
  )
    return emptyHighScores();
  const bySession = new Map<string, HighScoreEntry>();
  for (const rawEntry of value.entries) {
    const entry = readEntry(rawEntry);
    // First valid summary wins: repeated finishes cannot improve an existing session.
    if (entry && !bySession.has(entry.sessionId))
      bySession.set(entry.sessionId, entry);
  }
  return {
    schemaVersion: 1,
    entries: Array.from(bySession.values())
      .sort(compareHighScores)
      .slice(0, MAX_HIGH_SCORES),
  };
}

export function parseHighScores(raw: string | null): HighScoresList {
  if (!raw) return emptyHighScores();
  try {
    return normaliseList(JSON.parse(raw));
  } catch {
    return emptyHighScores();
  }
}

export function addHighScore(
  list: HighScoresList,
  entry: HighScoreEntry
): HighScoresList {
  const current = normaliseList(list);
  const incoming = readEntry(entry);
  if (
    !incoming ||
    current.entries.some(item => item.sessionId === incoming.sessionId)
  )
    return current;
  return normaliseList({
    schemaVersion: 1,
    entries: [...current.entries, incoming],
  });
}

/** Validate the score-bearing public question and its complete, possible attempt history. */
function correctFirstForQuestion(
  rawQuestion: unknown,
  rawProgress: unknown,
  collectionId: string,
  segmentMode: string,
  seenIds: Set<string>
): boolean | null {
  if (!isRecord(rawQuestion) || !isRecord(rawProgress)) return null;
  const question = rawQuestion;
  const progress = rawProgress;
  const questionFields = [
    "id",
    "collectionId",
    "segmentId",
    "headword",
    "partOfSpeech",
    "question",
    "answer",
    "distractors",
    "definition",
    "optionDefinitions",
    "options",
  ];
  const progressFields = [
    "attemptedOptions",
    "lastSelectedOption",
    "resolved",
    "firstAttemptCorrect",
  ];
  if (
    !questionFields.every(field => owns(question, field)) ||
    !progressFields.every(field => owns(progress, field))
  )
    return null;
  if (
    !isText(question.id, 128) ||
    !question.id.startsWith(`${collectionId}-`) ||
    !/^\d+$/.test(question.id.slice(collectionId.length + 1)) ||
    seenIds.has(question.id) ||
    question.collectionId !== collectionId ||
    ![`${collectionId}-p1`, `${collectionId}-p2`].includes(
      question.segmentId as string
    ) ||
    (segmentMode !== "full" && question.segmentId !== segmentMode) ||
    !isText(question.headword, 512) ||
    !isText(question.partOfSpeech, 128) ||
    !isText(question.question, 4096) ||
    question.question.split("{BLANK}").length !== 2 ||
    !isText(question.answer, 512) ||
    !isText(question.definition, 4096) ||
    !Array.isArray(question.distractors) ||
    question.distractors.length !== 3 ||
    !Array.isArray(question.options) ||
    question.options.length !== 4 ||
    !isRecord(question.optionDefinitions)
  )
    return null;
  const answers: unknown[] = [question.answer, ...question.distractors];
  const options: unknown[] = Array.from(question.options);
  if (
    !answers.every(option => isText(option, 512)) ||
    new Set(answers.map(option => (option as string).trim().toLowerCase()))
      .size !== 4 ||
    !options.every(
      option => typeof option === "string" && answers.includes(option)
    ) ||
    new Set(options).size !== 4 ||
    Object.keys(question.optionDefinitions).length !== 4 ||
    !answers.every(
      option =>
        owns(question.optionDefinitions as object, option as string) &&
        isText(
          (question.optionDefinitions as Record<string, unknown>)[
            option as string
          ],
          4096
        )
    ) ||
    question.optionDefinitions[question.answer] !== question.definition ||
    progress.resolved !== true ||
    typeof progress.firstAttemptCorrect !== "boolean" ||
    !Array.isArray(progress.attemptedOptions) ||
    progress.attemptedOptions.length < 1 ||
    progress.attemptedOptions.length > 4
  )
    return null;
  const attempts: unknown[] = Array.from(progress.attemptedOptions);
  const firstCorrect = attempts[0] === question.answer;
  if (
    !attempts.every(
      option => typeof option === "string" && options.includes(option)
    ) ||
    new Set(attempts).size !== attempts.length ||
    attempts[attempts.length - 1] !== question.answer ||
    attempts.slice(0, -1).includes(question.answer) ||
    progress.lastSelectedOption !== question.answer ||
    progress.firstAttemptCorrect !== firstCorrect
  )
    return null;
  seenIds.add(question.id);
  return firstCorrect;
}

/** Only explicit fresh regular completions qualify. Never infer eligibility for old snapshots. */
export function createHighScore(
  exercise: ExerciseSnapshot,
  completedAtUtc: string = new Date().toISOString()
): HighScoreEntry | null {
  if (!isRecord(exercise)) return null;
  const fields = [
    "schemaVersion",
    "highScoreEligible",
    "sessionId",
    "status",
    "selection",
    "questions",
    "questionProgress",
    "currentIndex",
    "score",
    "elapsedMs",
    "releaseVersion",
    "savedAtUtc",
  ];
  if (
    !fields.every(field => owns(exercise, field)) ||
    exercise.schemaVersion !== 2 ||
    exercise.highScoreEligible !== true ||
    (exercise.kind !== undefined && exercise.kind !== "regular") ||
    exercise.status !== "complete" ||
    !isRecord(exercise.selection) ||
    !Array.isArray(exercise.questions) ||
    !Array.isArray(exercise.questionProgress) ||
    !isText(exercise.releaseVersion, 128) ||
    !isUtcTimestamp(exercise.savedAtUtc)
  )
    return null;
  const selection = exercise.selection;
  if (
    ![
      "collectionId",
      "collectionLabel",
      "cefrLevel",
      "segmentMode",
      "segmentLabel",
      "rangeLabel",
      "requestedCount",
    ].every(field => owns(selection, field)) ||
    !isCollection(selection.collectionId) ||
    !isText(selection.collectionLabel, 128) ||
    selection.cefrLevel !==
      HIGH_SCORE_COLLECTIONS[selection.collectionId].cefrLevel ||
    ![
      "full",
      `${selection.collectionId}-p1`,
      `${selection.collectionId}-p2`,
    ].includes(selection.segmentMode)
  )
    return null;
  const count = exercise.questions.length;
  if (
    !QUESTION_COUNTS.includes(count) ||
    selection.requestedCount !== count ||
    exercise.questionProgress.length !== count ||
    exercise.currentIndex !== count - 1 ||
    !Number.isInteger(exercise.score) ||
    exercise.score < 0 ||
    exercise.score > count ||
    !isElapsed(exercise.elapsedMs)
  )
    return null;
  let correctFirst = 0;
  const seenIds = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const result = correctFirstForQuestion(
      exercise.questions[index],
      exercise.questionProgress[index],
      selection.collectionId,
      selection.segmentMode,
      seenIds
    );
    if (result === null) return null;
    if (result) correctFirst += 1;
  }
  if (exercise.score !== correctFirst) return null;
  if (selection.segmentMode === "full") {
    const firstHalf = exercise.questions.filter(
      question => question.segmentId === `${selection.collectionId}-p1`
    ).length;
    if (count % 2 !== 0 || firstHalf !== count / 2) return null;
  }
  return readEntry({
    sessionId: exercise.sessionId,
    collectionId: selection.collectionId,
    questionCount: count,
    correctFirst,
    elapsedMs: exercise.elapsedMs,
    completedAtUtc,
    segmentLabel: selection.segmentLabel,
    rangeLabel: selection.rangeLabel,
  });
}

export function rankForSession(
  list: HighScoresList,
  sessionId: string
): number | null {
  const index = normaliseList(list).entries.findIndex(
    entry => entry.sessionId === sessionId
  );
  return index === -1 ? null : index + 1;
}
