/** Oxbridge Ledger: regression tests use the real minimised release, never invented learner-facing questions. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyAttempt,
  buildExercise,
  formatActiveTime,
  getPerformanceRemark,
  getRangeLabel,
  normaliseSegmentMode,
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

describe("approved question selection", () => {
  it("uses the required yyyyMMdd.HHmm release version format", () => {
    expect(catalogue.releaseVersion).toMatch(/^\d{8}\.\d{4}$/);
  });

  it("runs ten 100-question full-list exercises with exact 50/50 allocation and no repeats", () => {
    const collection = catalogue.collections.find((item) => item.id === "ox3000-a1");
    expect(collection).toBeDefined();

    for (let run = 1; run <= 10; run += 1) {
      const exercise = buildRealFullList(collection!, run);
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
