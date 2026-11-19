/** Oxbridge Ledger: regression tests use the real minimised release, never invented learner-facing questions. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyAttempt,
  buildExercise,
  formatActiveTime,
  getPerformanceRemark,
  getRangeLabel,
  normaliseSegmentMode,
  retryExercise,
} from "./exercise";
import type {
  CollectionCatalogueItem,
  ExerciseSnapshot,
  ReleaseCatalogue,
  SegmentRelease,
} from "@/types";

const releaseRoot = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(releaseRoot, "catalog.json"), "utf8"),
) as ReleaseCatalogue;

function loadSegment(filename: string): SegmentRelease {
  return JSON.parse(readFileSync(resolve(releaseRoot, filename), "utf8")) as SegmentRelease;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function buildRealFullList(
  collection: CollectionCatalogueItem,
  seed: number,
  count = 100,
): ExerciseSnapshot {
  const releases = collection.segments.map((segment) => loadSegment(segment.dataFile));
  const questionsBySegment = Object.fromEntries(
    releases.map((release) => [release.segmentId, release.questions]),
  );
  return buildExercise(
    collection,
    "full",
    count,
    questionsBySegment,
    catalogue.releaseVersion,
    seededRandom(seed),
  );
}

function completeExercise(exercise: ExerciseSnapshot): ExerciseSnapshot {
  let score = 0;
  const questionProgress = exercise.questions.map((question, index) => {
    let progress = exercise.questionProgress[index];
    if (index % 2 === 0) {
      progress = applyAttempt(
        question.answer,
        progress,
        score,
        question.distractors[0],
      ).progress;
    }
    const result = applyAttempt(question.answer, progress, score, question.answer);
    score = result.score;
    return result.progress;
  });
  return {
    ...exercise,
    status: "complete",
    questionProgress,
    currentIndex: exercise.questions.length - 1,
    score,
    elapsedMs: 268_350,
  };
}

describe("approved question selection", () => {
  it("uses the required yyyyMMdd.HHmm release version format", () => {
    expect(catalogue.releaseVersion).toMatch(/^\d{8}\.\d{4}$/);
  });

  it("runs ten 100-question full-list exercises with exact 50/50 allocation and no repeats", () => {
    const collection = catalogue.collections.find((item) => item.id === "ox3000-a1");
    expect(collection).toBeDefined();

    for (let run = 1; run <= 10; run += 1) {
      const exercise = buildRealFullList(collection!, run);
      expect(exercise.highScoreEligible).toBe(true);
      expect(exercise.questions).toHaveLength(100);
      expect(new Set(exercise.questions.map((question) => question.id)).size).toBe(100);
      for (const segment of collection!.segments) {
        expect(
          exercise.questions.filter((question) => question.segmentId === segment.id),
        ).toHaveLength(50);
      }
      for (const question of exercise.questions) {
        expect(question.options).toHaveLength(4);
        expect(new Set(question.options).size).toBe(4);
        expect(question.options).toContain(question.answer);
        expect(Object.keys(question.optionDefinitions).sort()).toEqual(
          [...question.options].sort(),
        );
        expect(Object.values(question.optionDefinitions).every(Boolean)).toBe(true);
      }
    }
  });

  it("rejects an unavailable question count instead of inventing or repeating content", () => {
    const collection = catalogue.collections.find((item) => item.id === "ox5000-c1")!;
    const releases = collection.segments.map((segment) => loadSegment(segment.dataFile));
    const questionsBySegment = Object.fromEntries(
      releases.map((release) => [release.segmentId, release.questions]),
    );
    expect(() =>
      buildExercise(
        collection,
        collection.segments[1].id,
        collection.segments[1].availableCount + 1,
        questionsBySegment,
        catalogue.releaseVersion,
        seededRandom(8),
      ),
    ).toThrow("not available");
  });
});

describe("collection and segment selection", () => {
  it("normalises every stale segment id before range-label rendering", () => {
    for (const sourceCollection of catalogue.collections) {
      for (const targetCollection of catalogue.collections) {
        if (sourceCollection.id === targetCollection.id) continue;
        const staleMode = sourceCollection.segments[0].id;
        const effectiveMode = normaliseSegmentMode(targetCollection, staleMode);
        expect(effectiveMode).toBe(targetCollection.segments[0].id);
        expect(() => getRangeLabel(targetCollection, effectiveMode)).not.toThrow();
      }
    }
  });

  it("preserves full-list mode across collection changes", () => {
    for (const collection of catalogue.collections) {
      expect(normaliseSegmentMode(collection, "full")).toBe("full");
      expect(getRangeLabel(collection, "full")).toContain("Words");
    }
  });

  it("keeps strict range-label rejection for invalid unnormalised inputs", () => {
    expect(() => getRangeLabel(catalogue.collections[0], "foreign-segment")).toThrow(
      "not recognised",
    );
  });
});

describe("retrying a completed exercise", () => {
  const collection = catalogue.collections.find((item) => item.id === "ox3000-a2")!;

  it("preserves exact full-list and single-segment counts, selection, questions and option order", () => {
    const segment = loadSegment(collection.segments[0].dataFile);
    const exercises = [
      buildRealFullList(collection, 17, 10),
      buildExercise(
        collection,
        segment.segmentId,
        7,
        { [segment.segmentId]: segment.questions },
        catalogue.releaseVersion,
        seededRandom(29),
      ),
    ];

    for (const exercise of exercises) {
      const completed = completeExercise(exercise);
      const before = JSON.stringify(completed);
      const retry = retryExercise(completed);

      expect(retry.schemaVersion).toBe(completed.schemaVersion);
      expect(retry.releaseVersion).toBe(completed.releaseVersion);
      expect(retry.selection).toEqual(completed.selection);
      expect(retry.questions).toHaveLength(completed.selection.requestedCount);
      expect(retry.questions).toEqual(completed.questions);
      expect(retry.questions.map((question) => question.id)).toEqual(
        completed.questions.map((question) => question.id),
      );
      expect(retry.questions.map((question) => question.options)).toEqual(
        completed.questions.map((question) => question.options),
      );
      expect(retry.highScoreEligible).toBe(false);
      expect(completed.highScoreEligible).toBe(true);
      expect(JSON.stringify(completed)).toBe(before);
    }
  });

  it("creates independent nested objects, arrays and definition maps", () => {
    const completed = completeExercise(buildRealFullList(collection, 31, 10));
    const before = JSON.stringify(completed);
    const retry = retryExercise(completed);

    expect(retry).not.toBe(completed);
    expect(retry.selection).not.toBe(completed.selection);
    expect(retry.questions).not.toBe(completed.questions);
    expect(retry.questionProgress).not.toBe(completed.questionProgress);
    for (const [index, question] of retry.questions.entries()) {
      expect(question).not.toBe(completed.questions[index]);
      expect(question.options).not.toBe(completed.questions[index].options);
      expect(question.distractors).not.toBe(completed.questions[index].distractors);
      expect(question.optionDefinitions).not.toBe(
        completed.questions[index].optionDefinitions,
      );
      expect(retry.questionProgress[index]).not.toBe(completed.questionProgress[index]);
      expect(retry.questionProgress[index].attemptedOptions).not.toBe(
        completed.questionProgress[index].attemptedOptions,
      );
      if (index > 0) {
        expect(retry.questionProgress[index]).not.toBe(retry.questionProgress[0]);
        expect(retry.questionProgress[index].attemptedOptions).not.toBe(
          retry.questionProgress[0].attemptedOptions,
        );
      }
    }

    retry.selection.requestedCount = 1;
    retry.questions[0].headword = "changed";
    retry.questions[0].options.reverse();
    retry.questions[0].distractors.reverse();
    retry.questions[0].optionDefinitions[retry.questions[0].answer] = "changed";
    retry.questions.reverse();
    retry.questionProgress[0].attemptedOptions.push(retry.questions[0].answer);
    retry.questionProgress[0].resolved = true;
    retry.questionProgress.reverse();
    expect(JSON.stringify(completed)).toBe(before);
    expect(retry.questionProgress[0].attemptedOptions).toEqual([]);
  });

  it("resets every attempt, result and timer with a fresh UUID and current save time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T01:00:00.000Z"));
    const completed = completeExercise(buildRealFullList(collection, 41, 10));
    const newSessionId = "f19c60fa-d2bb-4a40-b7e0-216a28c06481";
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue(newSessionId);

    try {
      vi.setSystemTime(new Date("2026-11-19T02:03:04.567Z"));
      const retry = retryExercise(completed);

      expect(randomUUID).toHaveBeenCalledOnce();
      expect(retry.sessionId).toBe(newSessionId);
      expect(retry.sessionId).not.toBe(completed.sessionId);
      expect(retry.savedAtUtc).toBe("2026-11-19T02:03:04.567Z");
      expect(retry.savedAtUtc).not.toBe(completed.savedAtUtc);
      expect(retry.status).toBe("active");
      expect(retry.currentIndex).toBe(0);
      expect(retry.score).toBe(0);
      expect(retry.elapsedMs).toBe(0);
      expect(retry.questionProgress).toEqual(
        completed.questions.map(() => ({
          attemptedOptions: [],
          lastSelectedOption: null,
          resolved: false,
          firstAttemptCorrect: false,
        })),
      );
      expect(completed.status).toBe("complete");
      expect(completed.score).toBe(5);
      expect(completed.elapsedMs).toBe(268_350);
      expect(completed.questionProgress.every((progress) => progress.resolved)).toBe(true);
    } finally {
      randomUUID.mockRestore();
      vi.useRealTimers();
    }
  });

  it("serialises a retry and its in-progress state for deterministic resume", () => {
    const completed = completeExercise(buildRealFullList(collection, 51, 10));
    const retry = retryExercise(completed);
    expect(JSON.parse(JSON.stringify(retry))).toEqual(retry);

    const question = retry.questions[0];
    const wrong = applyAttempt(
      question.answer,
      retry.questionProgress[0],
      retry.score,
      question.distractors[0],
    );
    retry.questionProgress[0] = wrong.progress;
    retry.score = wrong.score;
    retry.elapsedMs = 1_230;
    const restored = JSON.parse(JSON.stringify(retry)) as ExerciseSnapshot;

    expect(restored).toEqual(retry);
    expect(restored.questions).toEqual(completed.questions);
    const recovered = applyAttempt(
      restored.questions[0].answer,
      restored.questionProgress[0],
      restored.score,
      restored.questions[0].answer,
    );
    expect(recovered.score).toBe(0);
    expect(recovered.progress.resolved).toBe(true);
    expect(recovered.progress.firstAttemptCorrect).toBe(false);
  });

  it("supports repeated retries without replacing questions or sharing state between sessions", () => {
    const completed = completeExercise(buildRealFullList(collection, 61, 10));
    const first = retryExercise(completed);
    const firstCompleted = completeExercise(first);
    const before = JSON.stringify(firstCompleted);
    const second = retryExercise(firstCompleted);
    const third = retryExercise(completed);

    expect(
      new Set([completed.sessionId, first.sessionId, second.sessionId, third.sessionId]).size,
    ).toBe(4);
    for (const retry of [first, second, third]) {
      expect(retry.questions).toEqual(completed.questions);
      expect(retry.selection).toEqual(completed.selection);
      expect(retry.highScoreEligible).toBe(false);
      expect(retry.score).toBe(0);
      expect(
        retry.questionProgress.every((progress) => progress.attemptedOptions.length === 0),
      ).toBe(true);
    }
    second.questions[0].options.reverse();
    second.questionProgress[0].attemptedOptions.push(second.questions[0].answer);
    expect(first.questions).toEqual(completed.questions);
    expect(third.questions).toEqual(completed.questions);
    expect(first.questionProgress[0].attemptedOptions).toEqual([]);
    expect(third.questionProgress[0].attemptedOptions).toEqual([]);
    expect(JSON.stringify(firstCompleted)).toBe(before);
  });

  it("restores first-attempt eligibility while keeping wrong-then-correct retries scoreless", () => {
    const completed = completeExercise(buildRealFullList(collection, 71, 10));
    expect(completed.questionProgress[0].firstAttemptCorrect).toBe(false);
    const retry = retryExercise(completed);
    const first = applyAttempt(
      retry.questions[0].answer,
      retry.questionProgress[0],
      retry.score,
      retry.questions[0].answer,
    );
    expect(first.score).toBe(1);
    expect(first.progress.firstAttemptCorrect).toBe(true);
    expect(
      applyAttempt(
        retry.questions[0].answer,
        first.progress,
        first.score,
        retry.questions[0].answer,
      ).score,
    ).toBe(1);

    const question = retry.questions[1];
    const wrong = applyAttempt(
      question.answer,
      retry.questionProgress[1],
      first.score,
      question.distractors[0],
    );
    const recovered = applyAttempt(question.answer, wrong.progress, wrong.score, question.answer);
    expect(recovered.score).toBe(1);
    expect(recovered.progress.resolved).toBe(true);
    expect(recovered.progress.firstAttemptCorrect).toBe(false);
    expect(completed.questionProgress[0].attemptedOptions).toHaveLength(2);
  });

  it("rejects active and empty snapshots", () => {
    const active = buildRealFullList(collection, 81, 10);
    expect(() => retryExercise(active)).toThrow("completed, non-empty");
    expect(() =>
      retryExercise({ ...completeExercise(active), questions: [], questionProgress: [] }),
    ).toThrow("completed, non-empty");
  });
});

describe("first-attempt scoring", () => {
  const untouched = {
    attemptedOptions: [],
    lastSelectedOption: null,
    resolved: false,
    firstAttemptCorrect: false,
  };

  it("awards one point only when the first selection is correct", () => {
    const result = applyAttempt("answer", untouched, 3, "answer");
    expect(result.score).toBe(4);
    expect(result.progress).toEqual({
      attemptedOptions: ["answer"],
      lastSelectedOption: "answer",
      resolved: true,
      firstAttemptCorrect: true,
    });
  });

  it("allows recovery after an incorrect first attempt without awarding a point", () => {
    const first = applyAttempt("answer", untouched, 3, "wrong");
    expect(first.score).toBe(3);
    expect(first.progress.resolved).toBe(false);
    expect(first.progress.lastSelectedOption).toBe("wrong");
    const second = applyAttempt("answer", first.progress, first.score, "answer");
    expect(second.score).toBe(3);
    expect(second.progress.resolved).toBe(true);
    expect(second.progress.firstAttemptCorrect).toBe(false);
  });

  it("ignores duplicate clicks and all clicks after resolution", () => {
    const first = applyAttempt("answer", untouched, 0, "wrong");
    expect(applyAttempt("answer", first.progress, 0, "wrong")).toEqual(first);
    const resolved = applyAttempt("answer", untouched, 0, "answer");
    expect(applyAttempt("answer", resolved.progress, 1, "other")).toEqual({
      progress: resolved.progress,
      score: 1,
    });
  });
});

describe("saved state and results presentation", () => {
  it("round-trips the exact real question order, option order, score, attempts, and elapsed time", () => {
    const collection = catalogue.collections.find((item) => item.id === "ox3000-a2")!;
    const releases = collection.segments.map((segment) => loadSegment(segment.dataFile));
    const original = buildExercise(
      collection,
      collection.segments[0].id,
      10,
      Object.fromEntries(releases.map((release) => [release.segmentId, release.questions])),
      catalogue.releaseVersion,
      seededRandom(99),
    );
    original.currentIndex = 3;
    original.score = 2;
    original.elapsedMs = 268_350;
    original.questionProgress[3] = {
      attemptedOptions: [original.questions[3].options[0]],
      lastSelectedOption: original.questions[3].options[0],
      resolved: false,
      firstAttemptCorrect: false,
    };

    const restored = JSON.parse(JSON.stringify(original)) as ExerciseSnapshot;
    expect(restored).toEqual(original);
    expect(restored.questions.map((question) => question.id)).toEqual(
      original.questions.map((question) => question.id),
    );
    expect(restored.questions.map((question) => question.options)).toEqual(
      original.questions.map((question) => question.options),
    );
  });

  it("keeps every sentence-initial option capitalised and includes the reported everyone correction", () => {
    let everyoneFound = false;
    for (const collection of catalogue.collections) {
      for (const segment of collection.segments) {
        for (const question of loadSegment(segment.dataFile).questions) {
          if (question.question.trimStart().startsWith("{BLANK}")) {
            for (const option of [question.answer, ...question.distractors]) {
              const firstLetter = [...option].find((character) => /[A-Za-z]/.test(character));
              expect(firstLetter, `${question.id}: ${option}`).toBe(firstLetter?.toUpperCase());
            }
          }
          if (question.id === "ox3000-a1-0281") {
            everyoneFound = true;
            expect(question.answer).toBe("Everyone");
            expect(question.distractors).toEqual(["Anything", "Everything", "It"]);
            expect(Object.keys(question.optionDefinitions).sort()).toEqual(
              ["Anything", "Everything", "Everyone", "It"].sort(),
            );
          }
        }
      }
    }
    expect(everyoneFound).toBe(true);
  });

  it("formats active time and all required performance bands correctly", () => {
    expect(formatActiveTime(268_350)).toBe("04:28.35");
    expect(getPerformanceRemark(100)).toBe("Outstanding — perfect score!");
    expect(getPerformanceRemark(90)).toBe("Excellent work!");
    expect(getPerformanceRemark(75)).toBe("Very good — keep building momentum.");
    expect(getPerformanceRemark(60)).toBe(
      "Good effort — review the words and try again.",
    );
    expect(getPerformanceRemark(59)).toBe("Keep practising — every attempt helps.");
  });
});
