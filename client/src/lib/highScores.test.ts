import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExerciseSnapshot,
  ReleaseCatalogue,
  SegmentRelease,
} from "../types";
import { applyAttempt, buildExercise, retryExercise } from "./exercise";
import { QUESTION_COUNTS } from "./setupPreference";
import {
  buildTrickyWordsExercise,
  addTrickyWord,
  emptyTrickyWords,
} from "./trickyWords";
import {
  HIGH_SCORE_COLLECTIONS,
  HIGH_SCORES_STORAGE_KEY,
  MAX_HIGH_SCORES,
  addHighScore,
  compareHighScores,
  createHighScore,
  emptyHighScores,
  parseHighScores,
  rankForSession,
  type HighScoreEntry,
  type HighScoresList,
} from "./highScores";

const COMPLETED = "2026-11-19T09:10:11.123Z";
const root = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(root, "catalog.json"), "utf8")
) as ReleaseCatalogue;
const collectionsDescending = [
  "cambridge-c2",
  "ox5000-c1",
  "ox5000-b2",
  "ox3000-b2",
  "ox3000-b1",
  "ox3000-a2",
  "ox3000-a1",
];
const summaryFields = [
  "sessionId",
  "collectionId",
  "questionCount",
  "correctFirst",
  "elapsedMs",
  "completedAtUtc",
  "segmentLabel",
  "rangeLabel",
].sort();

function entry(patch: Partial<HighScoreEntry> = {}): HighScoreEntry {
  return {
    sessionId: "session-a",
    collectionId: "ox3000-a1",
    questionCount: 10,
    correctFirst: 8,
    elapsedMs: 1234.567,
    completedAtUtc: COMPLETED,
    segmentLabel: "Segment 1",
    rangeLabel: "Words 1–450 (a – example)",
    ...patch,
  };
}
function list(entries: HighScoreEntry[]): HighScoresList {
  return { schemaVersion: 1, entries };
}
function parse(entries: unknown[]): HighScoresList {
  return parseHighScores(JSON.stringify({ schemaVersion: 1, entries }));
}
function completedExercise(
  collectionId = "ox3000-a1",
  count = 10,
  mode = "full",
  correct = 8
) {
  const collection = catalogue.collections.find(
    item => item.id === collectionId
  )!;
  const releases = Object.fromEntries(
    collection.segments.map(segment => [
      segment.id,
      (
        JSON.parse(
          readFileSync(resolve(root, segment.dataFile), "utf8")
        ) as SegmentRelease
      ).questions,
    ])
  );
  const snapshot = buildExercise(
    collection,
    mode,
    count,
    releases,
    catalogue.releaseVersion,
    () => 0.42
  );
  return finish(snapshot, correct);
}
function finish(snapshot: ExerciseSnapshot, correct: number): ExerciseSnapshot {
  const result = structuredClone(snapshot);
  result.score = 0;
  result.questions.forEach((question, index) => {
    let progress = result.questionProgress[index];
    if (index >= correct) {
      const wrong = applyAttempt(
        question.answer,
        progress,
        result.score,
        question.distractors[0]
      );
      progress = wrong.progress;
      result.score = wrong.score;
    }
    const answer = applyAttempt(
      question.answer,
      progress,
      result.score,
      question.answer
    );
    result.questionProgress[index] = answer.progress;
    result.score = answer.score;
  });
  result.status = "complete";
  result.currentIndex = result.questions.length - 1;
  result.elapsedMs = 1234.567;
  return result;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("high-score compact contract", () => {
  it("exports the agreed key, schema, ten-entry cap and independent empty lists", () => {
    expect(HIGH_SCORES_STORAGE_KEY).toBe("kslo.oxbridge.highScores.v1");
    expect(MAX_HIGH_SCORES).toBe(10);
    const first = emptyHighScores();
    first.entries.push(entry());
    expect(emptyHighScores()).toEqual({ schemaVersion: 1, entries: [] });
    expect(Object.keys(HIGH_SCORE_COLLECTIONS)).toEqual(collectionsDescending);
    for (const collection of catalogue.collections) {
      expect(HIGH_SCORE_COLLECTIONS[collection.id]).toMatchObject({
        label: collection.label,
        cefrLevel: collection.cefrLevel,
      });
    }
    expect(
      collectionsDescending.map(id => HIGH_SCORE_COLLECTIONS[id].rank)
    ).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });
  it("strips all unknown envelope/summary fields, including full questions and private metadata", () => {
    const source = {
      ...entry(),
      questions: completedExercise().questions,
      provenance: "private",
      accuracy: 80,
    };
    const restored = parseHighScores(
      JSON.stringify({ schemaVersion: 1, entries: [source], secret: true })
    );
    expect(restored).toEqual(list([entry()]));
    expect(Object.keys(restored).sort()).toEqual(["entries", "schemaVersion"]);
    expect(Object.keys(restored.entries[0]).sort()).toEqual(summaryFields);
    expect(addHighScore(emptyHighScores(), source)).toEqual(restored);
    expect(source.questions).toHaveLength(10);
  });
  it("does not access storage, network or master files from pure operations", () => {
    const getItem = vi.fn(() => {
      throw new Error("blocked");
    });
    const setItem = vi.fn(() => {
      throw new Error("blocked");
    });
    const fetch = vi.fn(() => {
      throw new Error("network");
    });
    vi.stubGlobal("window", { localStorage: { getItem, setItem } });
    vi.stubGlobal("fetch", fetch);
    const added = addHighScore(
      emptyHighScores(),
      createHighScore(completedExercise(), COMPLETED)!
    );
    expect(
      rankForSession(
        parseHighScores(JSON.stringify(added)),
        added.entries[0].sessionId
      )
    ).toBe(1);
    for (const operation of [getItem, setItem, fetch])
      expect(operation).not.toHaveBeenCalled();
  });
});

describe("ranking priorities and exact deterministic ties", () => {
  it("ranks every collection above all lower levels regardless of count, accuracy and time", () => {
    const records = collectionsDescending.map((collectionId, index) =>
      entry({
        sessionId: `level-${index}`,
        collectionId,
        questionCount: index === 0 ? 1 : 100,
        correctFirst: index === 0 ? 0 : 100,
        elapsedMs: index === 0 ? 999999 : 0,
      })
    );
    expect(
      parse([...records].reverse()).entries.map(item => item.collectionId)
    ).toEqual(collectionsDescending);
    for (let index = 1; index < collectionsDescending.length; index++) {
      expect(
        compareHighScores(
          entry({
            collectionId: collectionsDescending[index - 1],
            questionCount: 1,
            correctFirst: 0,
            elapsedMs: 1e9,
          }),
          entry({
            collectionId: collectionsDescending[index],
            questionCount: 100,
            correctFirst: 100,
            elapsedMs: 0,
          })
        )
      ).toBeLessThan(0);
    }
  });
  it("ranks actual count before first-attempt accuracy and time", () => {
    const records = QUESTION_COUNTS.map(questionCount =>
      entry({
        sessionId: `count-${questionCount}`,
        questionCount,
        correctFirst: 0,
      })
    );
    expect(parse(records).entries.map(item => item.questionCount)).toEqual(
      [...QUESTION_COUNTS].reverse()
    );
    expect(
      compareHighScores(
        entry({ questionCount: 20, correctFirst: 0, elapsedMs: 1e9 }),
        entry({ correctFirst: 10, elapsedMs: 0 })
      )
    ).toBeLessThan(0);
  });
  it("ranks correct-first accuracy before time, including the smallest supported count-tied difference", () => {
    expect(
      compareHighScores(
        entry({ questionCount: 100, correctFirst: 81, elapsedMs: 1e9 }),
        entry({ questionCount: 100, correctFirst: 80, elapsedMs: 0 })
      )
    ).toBeLessThan(0);
    expect(
      parse([
        entry({ sessionId: "low", correctFirst: 0 }),
        entry({ sessionId: "high", correctFirst: 10 }),
      ]).entries.map(item => item.sessionId)
    ).toEqual(["high", "low"]);
  });
  it("uses exact fractional active time rather than displayed centiseconds or wall time", () => {
    const fast = entry({
      sessionId: "z",
      elapsedMs: 1000.0001,
      completedAtUtc: "2026-11-20T00:00:00Z",
    });
    const slow = entry({
      sessionId: "a",
      elapsedMs: 1000.0002,
      completedAtUtc: "2026-11-18T00:00:00Z",
    });
    expect(compareHighScores(fast, slow)).toBeLessThan(0);
    expect(parse([slow, fast]).entries).toEqual([fast, slow]);
    expect(
      compareHighScores(entry({ elapsedMs: 0 }), entry({ elapsedMs: 0.00001 }))
    ).toBeLessThan(0);
  });
  it("uses earlier UTC completion, then code-point session IDs only for final ties", () => {
    const a = entry({ sessionId: "a", completedAtUtc: "2026-11-19T09:10:11Z" });
    const z = entry({
      sessionId: "z",
      completedAtUtc: "2026-11-19T09:10:11.000Z",
    });
    const later = entry({
      sessionId: "0",
      completedAtUtc: "2026-11-19T09:10:11.001Z",
    });
    expect(parse([later, z, a]).entries).toEqual([a, z, later]);
    expect(compareHighScores(a, { ...a })).toBe(0);
  });
  it("obeys reflexivity, antisymmetry, transitivity and repeatable sorting", () => {
    const records = Array.from({ length: 35 }, (_, index) =>
      entry({
        sessionId: `s-${String(index).padStart(2, "0")}`,
        collectionId: collectionsDescending[index % 7],
        questionCount: 10 + (index % 3) * 10,
        correctFirst: index % 10,
        elapsedMs: index / 1000,
      })
    );
    const sorted = [...records].sort(compareHighScores);
    expect([...records].reverse().sort(compareHighScores)).toEqual(sorted);
    for (const a of records) {
      expect(compareHighScores(a, a)).toBe(0);
      for (const b of records) {
        const ab = Math.sign(compareHighScores(a, b));
        const ba = Math.sign(compareHighScores(b, a));
        expect(ab === 0 ? ba === 0 : ab === -ba).toBe(true);
      }
    }
    for (let a = 0; a < sorted.length; a++)
      for (let b = a; b < sorted.length; b++) {
        expect(compareHighScores(sorted[a], sorted[b])).toBeLessThanOrEqual(0);
        for (let c = b; c < sorted.length; c++)
          expect(compareHighScores(sorted[a], sorted[c])).toBeLessThanOrEqual(
            0
          );
      }
  });
});

describe("top-ten insertion, identity and corruption recovery", () => {
  it("keeps exactly the best ten after sorting and deduplicating, not the most recent ten", () => {
    const records = Array.from({ length: 15 }, (_, index) =>
      entry({
        sessionId: `s-${index}`,
        correctFirst: index % 11,
        elapsedMs: index,
      })
    );
    const expected = [...records].sort(compareHighScores).slice(0, 10);
    const added = records.reduce(addHighScore, emptyHighScores());
    expect(added.entries).toEqual(expected);
    expect(parse([...records, ...records]).entries).toEqual(expected);
    expect(rankForSession(added, expected[9].sessionId)).toBe(10);
    expect(rankForSession(added, "missing")).toBeNull();
    expect(rankForSession(emptyHighScores(), "missing")).toBeNull();
  });
  it("is idempotent by session ID, preserving the first valid result instead of inflating it", () => {
    const original = list([entry()]);
    const changed = entry({
      correctFirst: 10,
      elapsedMs: 0,
      completedAtUtc: "2026-01-01T00:00:00Z",
    });
    expect(addHighScore(original, changed)).toEqual(original);
    expect(parse([null, entry(), changed]).entries).toEqual(original.entries);
    const distinct = addHighScore(
      original,
      entry({ sessionId: "other-session" })
    );
    expect(distinct.entries).toHaveLength(2);
  });
  it("always sorts/trims even when an incoming entry is invalid or a duplicate", () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      entry({ sessionId: `s-${index}`, elapsedMs: 12 - index })
    );
    const original = list(records);
    expect(addHighScore(original, records[0]).entries).toEqual(
      [...records].sort(compareHighScores).slice(0, 10)
    );
    expect(
      addHighScore(original, entry({ collectionId: "unknown" })).entries
    ).toHaveLength(10);
    expect(original.entries).toEqual(records);
  });
  it("never mutates or shares entries with frozen input lists and incoming entries", () => {
    const source = Object.freeze(entry());
    const original = list([source]);
    Object.freeze(original.entries);
    Object.freeze(original);
    const incoming = Object.freeze(entry({ sessionId: "other" }));
    const next = addHighScore(original, incoming);
    for (const result of next.entries) {
      expect(result).not.toBe(source);
      expect(result).not.toBe(incoming);
    }
    next.entries[0].rangeLabel = "changed";
    expect(source.rangeLabel).toBe(entry().rangeLabel);
  });
  it.each([
    null,
    "",
    "{",
    "not JSON",
    "null",
    "true",
    "0",
    "[]",
    "{}",
    '{"schemaVersion":1}',
    '{"schemaVersion":1,"entries":null}',
    '{"schemaVersion":1,"entries":{}}',
  ])("resets unusable data without throwing: %s", raw =>
    expect(parseHighScores(raw)).toEqual(emptyHighScores())
  );
  it.each([undefined, null, 0, 2, 99, "1"])(
    "rejects incompatible envelope schema %j without inventing a migration",
    schemaVersion => {
      expect(
        parseHighScores(JSON.stringify({ schemaVersion, entries: [entry()] }))
      ).toEqual(emptyHighScores());
    }
  );
  it.each([null, false, 17, "summary", [], {}])(
    "salvages valid neighbours around bad entries %j",
    bad => {
      expect(parse([entry(), bad, entry({ sessionId: "b" })])).toEqual(
        list([entry({ sessionId: "b" }), entry()])
      );
    }
  );
  it.each(summaryFields)("requires own correctly typed fields: %s", field => {
    for (const bad of [undefined, null, "", "   ", [], {}]) {
      expect(
        parse([{ ...entry(), [field]: bad }]).entries,
        `${field}: ${JSON.stringify(bad)}`
      ).toEqual([]);
    }
  });
  it.each([
    { questionCount: 0 },
    { questionCount: -1 },
    { questionCount: 101 },
    { questionCount: 1.5 },
    { questionCount: "10" },
    { correctFirst: -1 },
    { correctFirst: 11 },
    { correctFirst: 0.5 },
    { correctFirst: "8" },
    { elapsedMs: -1 },
    { elapsedMs: Infinity },
    { elapsedMs: NaN },
    { elapsedMs: "1234" },
    { elapsedMs: Number.MAX_VALUE },
    { sessionId: "x".repeat(129) },
    { segmentLabel: "x".repeat(129) },
    { rangeLabel: "x".repeat(513) },
    { collectionId: "unknown" },
    { collectionId: "__proto__" },
    { collectionId: "constructor" },
    { collectionId: "toString" },
  ])("rejects malformed bounded values %j", patch => {
    expect(parse([{ ...entry(), ...patch }]).entries).toEqual([]);
    expect(
      addHighScore(list([entry({ sessionId: "kept" })]), {
        ...entry(),
        ...patch,
      } as HighScoreEntry)
    ).toEqual(list([entry({ sessionId: "kept" })]));
  });
  it("accepts zero time, fractional milliseconds and bounded 1–100 summary counts", () => {
    for (const questionCount of [1, 7, 10, 99, 100])
      expect(
        parse([entry({ questionCount, correctFirst: 0, elapsedMs: 0 })]).entries
      ).toHaveLength(1);
    expect(parse([entry({ elapsedMs: 0.001 })]).entries[0].elapsedMs).toBe(
      0.001
    );
  });
  it.each([
    "not a date",
    "2026-11-19",
    "2026-11-19T09:10:11",
    "2026-11-19T09:10:11+08:00",
    "2026-02-30T09:10:11.123Z",
    "2026-13-19T09:10:11.123Z",
    "2026-11-19T24:10:11Z",
    "2026-11-19T09:10:60Z",
    "2026-11-19T09:10:11.1234Z",
  ])("rejects non-UTC or impossible completion dates %s", completedAtUtc =>
    expect(parse([entry({ completedAtUtc })]).entries).toEqual([])
  );
  it("preserves supported timestamp precision and bounded labels exactly", () => {
    for (const completedAtUtc of [
      "2026-11-19T09:10:11Z",
      "2026-11-19T09:10:11.1Z",
      "2026-11-19T09:10:11.01Z",
      COMPLETED,
    ]) {
      const source = entry({
        completedAtUtc,
        sessionId: "x".repeat(128),
        segmentLabel: "x".repeat(128),
        rangeLabel: "x".repeat(512),
      });
      expect(parse([source]).entries).toEqual([source]);
    }
  });
  it("rejects inherited fields and safely handles prototype-like session IDs and pollution keys", () => {
    expect(
      addHighScore(emptyHighScores(), Object.create(entry()) as HighScoreEntry)
    ).toEqual(emptyHighScores());
    expect(
      addHighScore(
        Object.create(list([entry()])) as HighScoresList,
        entry({ sessionId: "b" })
      )
    ).toEqual(list([entry({ sessionId: "b" })]));
    const sessions = ["__proto__", "constructor", "toString"].map(sessionId =>
      entry({ sessionId })
    );
    expect(parse(sessions).entries).toHaveLength(3);
    const polluted = JSON.stringify(list([entry()])).replace(
      '{"schemaVersion":1,',
      '{"__proto__":{"polluted":true},"schemaVersion":1,'
    );
    expect(parseHighScores(polluted)).toEqual(list([entry()]));
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});

describe("fresh completed regular exercise eligibility", () => {
  it.each(collectionsDescending)(
    "accepts authentic fresh completions from %s",
    collectionId => {
      const snapshot = completedExercise(collectionId);
      const before = JSON.stringify(snapshot);
      const score = createHighScore(snapshot, COMPLETED)!;
      expect(score).toEqual({
        sessionId: snapshot.sessionId,
        collectionId,
        questionCount: 10,
        correctFirst: 8,
        elapsedMs: snapshot.elapsedMs,
        completedAtUtc: COMPLETED,
        segmentLabel: snapshot.selection.segmentLabel,
        rangeLabel: snapshot.selection.rangeLabel,
      });
      expect(Object.keys(score).sort()).toEqual(summaryFields);
      expect(JSON.stringify(snapshot)).toBe(before);
    }
  );
  it.each(QUESTION_COUNTS)(
    "accepts current regular count %i with exact tally",
    count => {
      const snapshot = completedExercise("ox3000-a1", count, "ox3000-a1-p1", 0);
      expect(createHighScore(snapshot, COMPLETED)).toMatchObject({
        questionCount: count,
        correctFirst: 0,
      });
    }
  );
  it("requires explicit true eligibility but accepts absent kind or explicit regular kind", () => {
    const fresh = completedExercise();
    expect(createHighScore(fresh, COMPLETED)).not.toBeNull();
    expect(
      createHighScore({ ...fresh, kind: "regular" }, COMPLETED)
    ).not.toBeNull();
    for (const flag of [undefined, false, null, 1, "true"]) {
      expect(
        createHighScore(
          { ...fresh, highScoreEligible: flag } as ExerciseSnapshot,
          COMPLETED
        )
      ).toBeNull();
    }
    const legacy = structuredClone(fresh);
    delete legacy.highScoreEligible;
    expect(createHighScore(legacy, COMPLETED)).toBeNull();
    expect(legacy.score).toBe(fresh.score);
  });
  it("excludes completed same-exercise retries even with a perfect score and zero active time", () => {
    const retried = finish(retryExercise(completedExercise()), 10);
    retried.elapsedMs = 0;
    expect(retried.highScoreEligible).toBe(false);
    expect(createHighScore(retried, COMPLETED)).toBeNull();
  });
  it("excludes dedicated incorrect-question retries even if their flag and selection are forged fresh", () => {
    const fresh = completedExercise();
    const collection = catalogue.collections[0];
    const queue = fresh.questions.reduce(
      (current, question) =>
        addTrickyWord(
          current,
          question,
          {
            releaseVersion: catalogue.releaseVersion,
            collectionLabel: collection.label,
            cefrLevel: collection.cefrLevel,
          },
          COMPLETED
        ),
      emptyTrickyWords()
    );
    const retry = finish(buildTrickyWordsExercise(queue), 10);
    retry.highScoreEligible = true;
    expect(createHighScore(retry, COMPLETED)).toBeNull();
    retry.selection = structuredClone(fresh.selection);
    expect(createHighScore(retry, COMPLETED)).toBeNull();
  });
  it("uses current completion time by default, not the earlier saved timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(COMPLETED));
    const snapshot = completedExercise();
    snapshot.savedAtUtc = "2020-01-01T00:00:00.000Z";
    expect(createHighScore(snapshot)?.completedAtUtc).toBe(COMPLETED);
    expect(
      createHighScore(snapshot, "2026-11-20T00:00:00Z")?.completedAtUtc
    ).toBe("2026-11-20T00:00:00Z");
    expect(createHighScore(snapshot, "invalid")).toBeNull();
  });
  it.each([
    { schemaVersion: 1 },
    { kind: "unknown" },
    { status: "active" },
    { currentIndex: 8 },
    { currentIndex: 10 },
    { currentIndex: 9.5 },
    { score: 9 },
    { score: 7 },
    { score: 100 },
    { score: -1 },
    { score: 8.5 },
    { elapsedMs: -1 },
    { elapsedMs: Infinity },
    { elapsedMs: NaN },
    { elapsedMs: "0" },
    { sessionId: "" },
    { savedAtUtc: "invalid" },
    { releaseVersion: "" },
    { questions: [] },
    { questionProgress: [] },
    { questions: null },
    { questionProgress: null },
  ])("rejects incomplete or inconsistent snapshots %j", patch => {
    expect(
      createHighScore(
        { ...completedExercise(), ...patch } as ExerciseSnapshot,
        COMPLETED
      )
    ).toBeNull();
  });
  it.each([
    { collectionId: "unknown" },
    { collectionId: "__proto__" },
    { collectionId: "constructor" },
    { collectionId: "tricky-words" },
    { collectionId: "cambridge-c2", cefrLevel: "C2" },
    { cefrLevel: "C2" },
    { requestedCount: 20 },
    { requestedCount: "10" },
    { segmentMode: "tricky-words" },
    { segmentMode: "ox3000-a2-p1" },
    { segmentLabel: "" },
    { rangeLabel: "x".repeat(513) },
  ])("rejects malformed or inconsistent selection %j", patch => {
    const snapshot = completedExercise();
    Object.assign(snapshot.selection, patch);
    expect(createHighScore(snapshot, COMPLETED)).toBeNull();
  });
  it.each([
    { resolved: false },
    { firstAttemptCorrect: false },
    { firstAttemptCorrect: "true" },
    { lastSelectedOption: null },
    { lastSelectedOption: "not an option" },
    { attemptedOptions: [] },
    { attemptedOptions: ["not an option"] },
    { attemptedOptions: null },
  ])("rejects impossible resolved first-attempt history %j", patch => {
    const snapshot = completedExercise();
    Object.assign(snapshot.questionProgress[0], patch);
    expect(createHighScore(snapshot, COMPLETED)).toBeNull();
  });
  it("rejects duplicate attempts, attempts after resolution, wrong final selection and false first-attempt points", () => {
    const variants = [
      (snapshot: ExerciseSnapshot) => {
        const p = snapshot.questionProgress[0];
        p.attemptedOptions.push(p.attemptedOptions[0]);
      },
      (snapshot: ExerciseSnapshot) => {
        snapshot.questionProgress[0].attemptedOptions.push(
          snapshot.questions[0].distractors[0]
        );
      },
      (snapshot: ExerciseSnapshot) => {
        snapshot.questionProgress[0].lastSelectedOption =
          snapshot.questions[0].distractors[0];
      },
      (snapshot: ExerciseSnapshot) => {
        snapshot.questionProgress[8].firstAttemptCorrect = true;
        snapshot.score++;
      },
      (snapshot: ExerciseSnapshot) => {
        snapshot.questionProgress[8].attemptedOptions = [
          snapshot.questions[8].distractors[0],
        ];
      },
    ];
    for (const change of variants) {
      const snapshot = completedExercise();
      change(snapshot);
      expect(createHighScore(snapshot, COMPLETED)).toBeNull();
    }
  });
  it.each([
    { id: "unrelated-0001" },
    { id: "ox3000-a1-preview" },
    { collectionId: "cambridge-c2" },
    { segmentId: "ox3000-a2-p1" },
    { answer: "not an option" },
    { options: [] },
    { distractors: [] },
    { headword: "" },
    { partOfSpeech: "" },
    { question: "no blank" },
    { definition: "" },
    { optionDefinitions: {} },
  ])("rejects malformed score-bearing question %j", patch => {
    const snapshot = completedExercise();
    Object.assign(snapshot.questions[0], patch);
    expect(createHighScore(snapshot, COMPLETED)).toBeNull();
  });
  it("rejects duplicate IDs, short/sparse progress, sparse options and inconsistent full-list allocation", () => {
    const variants = [
      (s: ExerciseSnapshot) => {
        s.questions[1].id = s.questions[0].id;
      },
      (s: ExerciseSnapshot) => {
        s.questionProgress.pop();
      },
      (s: ExerciseSnapshot) => {
        delete s.questionProgress[0];
      },
      (s: ExerciseSnapshot) => {
        delete s.questions[0];
      },
      (s: ExerciseSnapshot) => {
        delete s.questions[0].options[0];
      },
      (s: ExerciseSnapshot) => {
        delete s.questionProgress[0].attemptedOptions[0];
      },
      (s: ExerciseSnapshot) => {
        s.questions[0].segmentId = s.questions[0].segmentId.endsWith("p1")
          ? "ox3000-a1-p2"
          : "ox3000-a1-p1";
      },
    ];
    for (const change of variants) {
      const snapshot = completedExercise();
      change(snapshot);
      expect(createHighScore(snapshot, COMPLETED)).toBeNull();
    }
  });
  it("does not accept arbitrary development-only counts or inherited eligibility", () => {
    const snapshot = completedExercise("ox3000-a1", 7, "ox3000-a1-p1", 5);
    expect(createHighScore(snapshot, COMPLETED)).toBeNull();
    expect(
      createHighScore(
        Object.create(completedExercise()) as ExerciseSnapshot,
        COMPLETED
      )
    ).toBeNull();
  });
  it("accepts valid zero-time rapid fresh completions and JSON-restored snapshots unchanged", () => {
    const snapshot = completedExercise();
    snapshot.elapsedMs = 0;
    expect(
      createHighScore(
        JSON.parse(JSON.stringify(snapshot)) as ExerciseSnapshot,
        COMPLETED
      )
    ).toMatchObject({ elapsedMs: 0, correctFirst: 8 });
  });
});
