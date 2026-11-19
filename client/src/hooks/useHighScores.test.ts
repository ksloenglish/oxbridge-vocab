import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExerciseSnapshot,
  ReleaseCatalogue,
  SegmentRelease,
} from "@/types";

// Exercise storage transactions without adding a DOM or test-renderer dependency.
vi.mock("react", () => ({
  useState: (initial: unknown) => [
    typeof initial === "function" ? initial() : initial,
    vi.fn(),
  ],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));

import { useHighScores } from "./useHighScores";
import { buildExercise, retryExercise } from "@/lib/exercise";
import {
  addHighScore,
  createHighScore,
  emptyHighScores,
  HIGH_SCORES_STORAGE_KEY,
  parseHighScores,
} from "@/lib/highScores";

const root = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(root, "catalog.json"), "utf8")
) as ReleaseCatalogue;
const collection = catalogue.collections[0];
const segment = JSON.parse(
  readFileSync(resolve(root, collection.segments[0].dataFile), "utf8")
) as SegmentRelease;

function completed(id: string, correct = 9): ExerciseSnapshot {
  const exercise = buildExercise(
    collection,
    segment.segmentId,
    10,
    { [segment.segmentId]: segment.questions },
    catalogue.releaseVersion,
    () => 0.4
  );
  return {
    ...exercise,
    sessionId: id,
    status: "complete",
    currentIndex: 9,
    score: correct,
    elapsedMs: 123_456.789,
    questionProgress: exercise.questions.map((question, index) => ({
      attemptedOptions:
        index < correct
          ? [question.answer]
          : [question.distractors[0], question.answer],
      lastSelectedOption: question.answer,
      resolved: true,
      firstAttemptCorrect: index < correct,
    })),
  };
}

let values: Map<string, string>;
let blocked: boolean;
let writes: number;
beforeEach(() => {
  values = new Map([["other.app.key", "preserve"]]);
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
      removeItem: (key: string) => values.delete(key),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function savedIds() {
  return parseHighScores(
    values.get(HIGH_SCORES_STORAGE_KEY) ?? null
  ).entries.map(entry => entry.sessionId);
}

describe("high-score completion transactions", () => {
  it("records a fresh completed session once and returns its new rank", () => {
    const hook = useHighScores();
    const session = completed("fresh-first");
    expect(hook.recordCompleted(session)).toEqual({ rank: 1, persisted: true });
    expect(hook.recordCompleted(session).rank).toBeNull();
    expect(writes).toBe(1);
    expect(savedIds()).toEqual(["fresh-first"]);
    expect(values.get("other.app.key")).toBe("preserve");
  });

  it("never records same-exercise retries, incorrect-question retries, legacy or unfinished sessions", () => {
    const hook = useHighScores();
    const fresh = completed("fresh");
    const legacy = { ...fresh, highScoreEligible: undefined };
    const retry = retryExercise(fresh);
    const finishedRetry = {
      ...fresh,
      sessionId: retry.sessionId,
      highScoreEligible: retry.highScoreEligible,
    };
    for (const session of [
      legacy,
      finishedRetry,
      { ...fresh, kind: "tricky-words" as const },
      { ...fresh, status: "active" as const },
    ]) {
      expect(hook.recordCompleted(session).rank).toBeNull();
    }
    expect(writes).toBe(0);
    expect(savedIds()).toEqual([]);
  });

  it("merges the latest other-tab scores before a healthy completion", () => {
    const hook = useHighScores();
    const other = createHighScore(completed("other-tab"))!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), other))
    );
    hook.recordCompleted(completed("our-tab", 10));
    expect(savedIds()).toEqual(["our-tab", "other-tab"]);
  });

  it("keeps failed saves in memory and never overwrites a recovered other tab", () => {
    const hook = useHighScores();
    blocked = true;
    expect(hook.recordCompleted(completed("memory-first"))).toEqual({
      rank: 1,
      persisted: false,
    });
    expect(writes).toBe(1);
    blocked = false;
    const other = createHighScore(completed("persisted-other", 10))!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), other))
    );
    const next = hook.recordCompleted(completed("memory-second", 10));
    expect(next.persisted).toBe(false);
    expect(writes).toBe(1);
    expect(savedIds()).toEqual(["persisted-other"]);
    expect(hook.refresh().entries.map(entry => entry.sessionId)).toEqual([
      "memory-second",
      "memory-first",
    ]);
  });

  it("does not mark an already persisted session as a new high score", () => {
    const entry = createHighScore(completed("already-saved"))!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), entry))
    );
    const hook = useHighScores();
    expect(hook.recordCompleted(completed("already-saved")).rank).toBeNull();
    expect(writes).toBe(0);
    expect(savedIds()).toEqual(["already-saved"]);
  });
});

describe("confirmed high-score reset transactions", () => {
  it("clears history without touching progress, mistakes or Home preferences and accepts a new score", () => {
    const otherKeys = [
      "kslo.oxbridge.savedExercise.v1",
      "kslo.oxbridge.trickyWords.v1",
      "kslo.oxbridge.setupPreference.v1",
    ];
    for (const key of otherKeys) values.set(key, "keep:" + key);
    const hook = useHighScores();
    const previous = completed("before-clear");
    hook.recordCompleted(previous);
    expect(hook.clearScores()).toEqual({
      list: emptyHighScores(),
      persisted: true,
      warning: null,
    });
    expect(values.has(HIGH_SCORES_STORAGE_KEY)).toBe(false);
    expect(hook.refresh().entries).toHaveLength(0);
    // Clearing history does not make a previous completion eligible to record again.
    expect(hook.recordCompleted(previous).rank).toBeNull();
    expect(values.has(HIGH_SCORES_STORAGE_KEY)).toBe(false);
    expect(hook.recordCompleted(completed("after-clear"))).toEqual({
      rank: 1,
      persisted: true,
    });
    expect(savedIds()).toEqual(["after-clear"]);
    for (const key of otherKeys) expect(values.get(key)).toBe("keep:" + key);
    expect(values.get("other.app.key")).toBe("preserve");
  });

  it("keeps a failed clear visit-only, without restoring or overwriting other-tab history", () => {
    const previous = createHighScore(completed("stored-before-clear"))!;
    const original = JSON.stringify(addHighScore(emptyHighScores(), previous));
    values.set(HIGH_SCORES_STORAGE_KEY, original);
    const hook = useHighScores();
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked removal");
    });
    const result = hook.clearScores();
    expect(result.persisted).toBe(false);
    expect(result.warning).toContain("refreshing");
    expect(hook.refresh().entries).toEqual([]);
    expect(values.get(HIGH_SCORES_STORAGE_KEY)).toBe(original);
    const other = createHighScore(completed("other-tab-after-failure"))!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), other))
    );
    expect(hook.recordCompleted(completed("visit-only-new")).persisted).toBe(
      false
    );
    expect(savedIds()).toEqual(["other-tab-after-failure"]);
    expect(hook.refresh().entries.map(entry => entry.sessionId)).toEqual([
      "visit-only-new",
    ]);
    expect(writes).toBe(0);
  });

  it("a successful explicit clear can establish a fresh healthy baseline after a failed save", () => {
    const hook = useHighScores();
    blocked = true;
    const failed = completed("failed-save-before-clear");
    expect(hook.recordCompleted(failed).persisted).toBe(false);
    blocked = false;
    const other = createHighScore(
      completed("other-tab-before-confirmed-reset")
    )!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), other))
    );
    expect(hook.clearScores().persisted).toBe(true);
    expect(hook.refresh().entries).toEqual([]);
    expect(values.has(HIGH_SCORES_STORAGE_KEY)).toBe(false);
    expect(hook.recordCompleted(failed).rank).toBeNull();
    expect(hook.recordCompleted(completed("fresh-after-reset"))).toEqual({
      rank: 1,
      persisted: true,
    });
    expect(savedIds()).toEqual(["fresh-after-reset"]);
  });

  it("reads the latest other-tab list after a healthy history removal", () => {
    const previous = createHighScore(completed("other-tab-existing"))!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), previous))
    );
    const hook = useHighScores();
    // The storage-event listener invokes this same refresh path.
    values.delete(HIGH_SCORES_STORAGE_KEY);
    expect(hook.refresh().entries).toEqual([]);
    const next = createHighScore(completed("other-tab-new"))!;
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(addHighScore(emptyHighScores(), next))
    );
    expect(hook.refresh().entries.map(entry => entry.sessionId)).toEqual([
      "other-tab-new",
    ]);
    hook.recordCompleted(completed("our-new", 10));
    expect(savedIds()).toEqual(["our-new", "other-tab-new"]);
  });
});
