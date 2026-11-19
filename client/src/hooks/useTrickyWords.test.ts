import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExerciseSnapshot,
  ReleaseCatalogue,
  SegmentRelease,
} from "@/types";

// Exercise the hook's storage transactions without adding a DOM or test-renderer dependency.
vi.mock("react", () => ({
  useState: (initial: unknown) => [
    typeof initial === "function" ? initial() : initial,
    vi.fn(),
  ],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));

import { useTrickyWords } from "./useTrickyWords";
import {
  addTrickyWord,
  buildTrickyWordsExercise,
  emptyTrickyWords,
  parseTrickyWords,
  TRICKY_WORDS_STORAGE_KEY,
} from "@/lib/trickyWords";

const root = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(root, "catalog.json"), "utf8")
) as ReleaseCatalogue;
const collection = catalogue.collections[0];
const questions = (
  JSON.parse(
    readFileSync(resolve(root, collection.segments[0].dataFile), "utf8")
  ) as SegmentRelease
).questions;
const metadata = {
  releaseVersion: catalogue.releaseVersion,
  collectionLabel: collection.label,
  cefrLevel: collection.cefrLevel,
};

function queueOf(indices: number[]) {
  return indices.reduce(
    (list, index) => addTrickyWord(list, questions[index], metadata),
    emptyTrickyWords()
  );
}
function answered(
  index: number,
  correct: boolean,
  kind: "regular" | "tricky-words" = "regular"
): ExerciseSnapshot {
  const snapshot = buildTrickyWordsExercise(queueOf([index]), () => 0.4);
  snapshot.kind = kind;
  snapshot.questionProgress[0] = {
    attemptedOptions: [
      correct ? questions[index].answer : questions[index].distractors[0],
    ],
    lastSelectedOption: correct
      ? questions[index].answer
      : questions[index].distractors[0],
    resolved: correct,
    firstAttemptCorrect: correct,
  };
  snapshot.score = correct ? 1 : 0;
  return snapshot;
}

let values: Map<string, string>;
let blocked: boolean;
let writes: number;
beforeEach(() => {
  values = new Map([[TRICKY_WORDS_STORAGE_KEY, JSON.stringify(queueOf([0]))]]);
  blocked = false;
  writes = 0;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes++;
        if (blocked) throw new Error("Storage blocked");
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function persistedIds() {
  return parseTrickyWords(
    values.get(TRICKY_WORDS_STORAGE_KEY) ?? null
  ).entries.map(entry => entry.question.id);
}

describe("incorrect-question persistence transactions", () => {
  it("does not overwrite another tab after a failed write recovers", () => {
    const hook = useTrickyWords();
    blocked = true;
    hook.recordFirstAnswer(answered(1, false), 0);
    expect(writes).toBe(1);
    expect(hook.refresh().entries.map(entry => entry.question.id)).toEqual([
      questions[0].id,
      questions[1].id,
    ]);
    // A second tab successfully adds a different pending question.
    blocked = false;
    values.set(TRICKY_WORDS_STORAGE_KEY, JSON.stringify(queueOf([0, 2])));
    hook.recordFirstAnswer(answered(3, false), 0);
    expect(writes).toBe(1);
    expect(persistedIds()).toEqual([questions[0].id, questions[2].id]);
    expect(hook.refresh().entries.map(entry => entry.question.id)).toEqual([
      questions[0].id,
      questions[1].id,
      questions[3].id,
    ]);
  });

  it("reads the latest other-tab queue before normal successful updates", () => {
    const hook = useTrickyWords();
    values.set(TRICKY_WORDS_STORAGE_KEY, JSON.stringify(queueOf([0, 2])));
    hook.recordFirstAnswer(answered(1, false), 0);
    expect(new Set(persistedIds())).toEqual(
      new Set([questions[0].id, questions[2].id, questions[1].id])
    );
  });

  it("keeps first-go removals local after failure and does not restore them during this visit", () => {
    const hook = useTrickyWords();
    blocked = true;
    hook.recordFirstAnswer(answered(0, true, "tricky-words"), 0);
    expect(hook.refresh().entries).toHaveLength(0);
    expect(persistedIds()).toEqual([questions[0].id]);
    blocked = false;
    hook.recordFirstAnswer(answered(1, false), 0);
    expect(writes).toBe(1);
    expect(hook.refresh().entries.map(entry => entry.question.id)).toEqual([
      questions[1].id,
    ]);
  });

  it("does not remove saved questions for correct regular answers or wrong retry answers", () => {
    const hook = useTrickyWords();
    hook.recordFirstAnswer(answered(0, true), 0);
    hook.recordFirstAnswer(answered(0, false, "tricky-words"), 0);
    expect(writes).toBe(0);
    expect(persistedIds()).toEqual([questions[0].id]);
  });
});
