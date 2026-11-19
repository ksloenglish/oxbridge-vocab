/** Oxbridge Ledger: a bounded, public-only first-miss queue, independent of browser storage. */
import type { ExerciseSnapshot, ReleaseQuestion } from "../types";
import { shuffle } from "./exercise";

export const TRICKY_WORDS_STORAGE_KEY = "kslo.oxbridge.trickyWords.v1";
export const MAX_TRICKY_WORDS = 500;
export const MAX_TRICKY_WORDS_BYTES = 1_000_000;

export interface TrickyWordEntry {
  question: ReleaseQuestion;
  firstMissedAtUtc: string;
  releaseVersion: string;
  collectionLabel: string;
  cefrLevel: string;
}

export interface TrickyWordsList {
  schemaVersion: 1;
  entries: TrickyWordEntry[];
}

type SourceMetadata = {
  releaseVersion: string;
  collectionLabel: string;
  cefrLevel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function owns(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Require an actual UTC instant, rejecting Date.parse's permissive rollover and local dates. */
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

/** Validate required release fields, then explicitly project them: never spread untrusted content. */
function publicQuestion(value: unknown): ReleaseQuestion | null {
  if (!isRecord(value)) return null;
  const fields = [
    "id",
    "headword",
    "partOfSpeech",
    "collectionId",
    "segmentId",
    "question",
    "answer",
    "definition",
  ] as const;
  for (const field of fields) {
    if (!owns(value, field) || !isText(value[field])) return null;
  }
  const {
    id,
    headword,
    partOfSpeech,
    collectionId,
    segmentId,
    question,
    answer,
    definition,
  } = value as Record<(typeof fields)[number], string>;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collectionId) ||
    !id.startsWith(`${collectionId}-`) ||
    !/^\d+$/.test(id.slice(collectionId.length + 1)) ||
    ![`${collectionId}-p1`, `${collectionId}-p2`].includes(segmentId) ||
    question.split("{BLANK}").length !== 2
  )
    return null;

  if (!owns(value, "distractors") || !Array.isArray(value.distractors))
    return null;
  if (value.distractors.length !== 3 || !value.distractors.every(isText))
    return null;
  const distractors: [string, string, string] = [
    value.distractors[0],
    value.distractors[1],
    value.distractors[2],
  ];
  if (!distractors.every(isText)) return null;
  const options = [answer, ...distractors];
  if (new Set(options.map(option => option.trim().toLowerCase())).size !== 4)
    return null;

  if (!owns(value, "optionDefinitions") || !isRecord(value.optionDefinitions))
    return null;
  const definitions = value.optionDefinitions;
  if (
    Object.keys(definitions).length !== 4 ||
    !options.every(
      option => owns(definitions, option) && isText(definitions[option])
    ) ||
    definitions[answer] !== definition
  )
    return null;

  if (question.trimStart().startsWith("{BLANK}")) {
    for (const option of options) {
      const firstLetter = Array.from(option).find(character =>
        /[A-Za-z]/.test(character)
      );
      if (!firstLetter || firstLetter !== firstLetter.toUpperCase())
        return null;
    }
  }

  return {
    id,
    headword,
    partOfSpeech,
    collectionId,
    segmentId,
    question,
    answer,
    distractors,
    definition,
    optionDefinitions: Object.fromEntries(
      options.map(option => [option, definitions[option] as string])
    ),
  };
}

function readEntry(value: unknown): TrickyWordEntry | null {
  if (!isRecord(value)) return null;
  if (
    !owns(value, "question") ||
    !owns(value, "firstMissedAtUtc") ||
    !isUtcTimestamp(value.firstMissedAtUtc) ||
    !owns(value, "releaseVersion") ||
    !isText(value.releaseVersion) ||
    !owns(value, "collectionLabel") ||
    !isText(value.collectionLabel) ||
    !owns(value, "cefrLevel") ||
    !isText(value.cefrLevel)
  )
    return null;
  const question = publicQuestion(value.question);
  if (!question) return null;
  return {
    question,
    firstMissedAtUtc: value.firstMissedAtUtc,
    releaseVersion: value.releaseVersion,
    collectionLabel: value.collectionLabel,
    cefrLevel: value.cefrLevel,
  };
}

export function emptyTrickyWords(): TrickyWordsList {
  return { schemaVersion: 1, entries: [] };
}

const EMPTY_LIST_BYTES = JSON.stringify(emptyTrickyWords()).length * 2;

/** UTF-16 estimate includes the JSON envelope and separators, not just question text. */
function entryBytes(entry: TrickyWordEntry): number {
  return JSON.stringify(entry).length * 2;
}

function boundEntries(entries: TrickyWordEntry[]): TrickyWordsList {
  // An impossible single entry must not evict the useful queue before being discarded.
  const fitting = entries.filter(
    entry => EMPTY_LIST_BYTES + entryBytes(entry) <= MAX_TRICKY_WORDS_BYTES
  );
  const sizes = fitting.map(entryBytes);
  let bytes =
    EMPTY_LIST_BYTES +
    sizes.reduce((sum, size) => sum + size, 0) +
    Math.max(0, fitting.length - 1) * 2;
  let oldest = 0;
  while (
    fitting.length - oldest > MAX_TRICKY_WORDS ||
    bytes > MAX_TRICKY_WORDS_BYTES
  ) {
    bytes -= sizes[oldest] + (fitting.length - oldest > 1 ? 2 : 0);
    oldest += 1;
  }
  return { schemaVersion: 1, entries: fitting.slice(oldest) };
}

/** Salvage valid entries; strip extra fields, deduplicate IDs and keep stable chronological order. */
function normaliseList(value: unknown): TrickyWordsList {
  if (
    !isRecord(value) ||
    !owns(value, "schemaVersion") ||
    value.schemaVersion !== 1 ||
    !owns(value, "entries") ||
    !Array.isArray(value.entries)
  )
    return emptyTrickyWords();

  const byId = new Map<string, TrickyWordEntry>();
  for (const rawEntry of value.entries) {
    const entry = readEntry(rawEntry);
    if (!entry || EMPTY_LIST_BYTES + entryBytes(entry) > MAX_TRICKY_WORDS_BYTES)
      continue;
    const previous = byId.get(entry.question.id);
    // Latest valid content wins, but even corrupt duplicate records cannot reset first miss.
    if (
      previous &&
      Date.parse(previous.firstMissedAtUtc) <=
        Date.parse(entry.firstMissedAtUtc)
    ) {
      entry.firstMissedAtUtc = previous.firstMissedAtUtc;
    }
    byId.set(entry.question.id, entry);
  }
  // ECMAScript's stable sort retains insertion order for equal first-miss instants.
  const entries = Array.from(byId.values()).sort(
    (left, right) =>
      Date.parse(left.firstMissedAtUtc) - Date.parse(right.firstMissedAtUtc)
  );
  return boundEntries(entries);
}

export function parseTrickyWords(raw: string | null): TrickyWordsList {
  if (typeof raw !== "string") return emptyTrickyWords();
  try {
    return normaliseList(JSON.parse(raw));
  } catch {
    return emptyTrickyWords();
  }
}

export function addTrickyWord(
  list: TrickyWordsList,
  question: ReleaseQuestion,
  metadata: SourceMetadata,
  now: string = new Date().toISOString()
): TrickyWordsList {
  const current = normaliseList(list);
  // Runtime validation also handles exercise questions carrying transient `options` safely.
  const entry = readEntry({
    question,
    firstMissedAtUtc: now,
    releaseVersion: metadata?.releaseVersion,
    collectionLabel: metadata?.collectionLabel,
    cefrLevel: metadata?.cefrLevel,
  });
  if (!entry || EMPTY_LIST_BYTES + entryBytes(entry) > MAX_TRICKY_WORDS_BYTES)
    return current;
  const index = current.entries.findIndex(
    item => item.question.id === entry.question.id
  );
  if (index >= 0) {
    entry.firstMissedAtUtc = current.entries[index].firstMissedAtUtc;
    current.entries[index] = entry;
  } else {
    current.entries.push(entry);
  }
  return boundEntries(
    current.entries.sort(
      (left, right) =>
        Date.parse(left.firstMissedAtUtc) - Date.parse(right.firstMissedAtUtc)
    )
  );
}

export function removeTrickyWord(
  list: TrickyWordsList,
  id: string
): TrickyWordsList {
  const current = normaliseList(list);
  return {
    schemaVersion: 1,
    entries: current.entries.filter(entry => entry.question.id !== id),
  };
}

/** All retained questions, oldest first; only each option set is shuffled, once per session. */
export function buildTrickyWordsExercise(
  list: TrickyWordsList,
  random: () => number = Math.random
): ExerciseSnapshot {
  const { entries } = normaliseList(list);
  const levels = new Set(entries.map(entry => entry.cefrLevel));
  const releases = new Set(entries.map(entry => entry.releaseVersion));
  return {
    schemaVersion: 2,
    kind: "tricky-words",
    releaseVersion:
      releases.size === 1
        ? entries[0].releaseVersion
        : entries.length
          ? "Mixed saved releases"
          : "Tricky words (no saved release)",
    sessionId: crypto.randomUUID(),
    status: "active",
    selection: {
      collectionId: "tricky-words",
      collectionLabel: "Incorrect questions",
      segmentMode: "tricky-words",
      segmentLabel: "Oldest first",
      rangeLabel: "Questions missed on the first attempt",
      cefrLevel: levels.size === 1 ? entries[0].cefrLevel : "Mixed",
      requestedCount: entries.length,
    },
    questions: entries.map(({ question }) => ({
      ...question,
      options: shuffle([question.answer, ...question.distractors], random),
    })),
    questionProgress: entries.map(() => ({
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
