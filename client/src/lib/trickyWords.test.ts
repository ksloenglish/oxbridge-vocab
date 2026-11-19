/** Real public releases underpin queue and practice regressions; malformed variants are boundary probes. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExerciseQuestion,
  ExerciseSnapshot,
  ReleaseCatalogue,
  ReleaseQuestion,
  SegmentRelease,
} from "../types";
import { applyAttempt, buildExercise } from "./exercise";
import {
  TRICKY_WORDS_STORAGE_KEY,
  MAX_TRICKY_WORDS,
  MAX_TRICKY_WORDS_BYTES,
  emptyTrickyWords,
  parseTrickyWords,
  addTrickyWord,
  removeTrickyWord,
  buildTrickyWordsExercise,
  type TrickyWordEntry,
  type TrickyWordsList,
} from "./trickyWords";

const releaseRoot = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(releaseRoot, "catalog.json"), "utf8")
) as ReleaseCatalogue;
const releases = catalogue.collections.flatMap(collection =>
  collection.segments.map(
    segment =>
      JSON.parse(
        readFileSync(resolve(releaseRoot, segment.dataFile), "utf8")
      ) as SegmentRelease
  )
);
const questions = releases.flatMap(release => release.questions);
const FIRST_MISS = "2026-11-18T01:02:03.000Z";
const LATER_MISS = "2026-11-19T01:02:03.000Z";
const publicFields = [
  "id",
  "headword",
  "partOfSpeech",
  "collectionId",
  "segmentId",
  "question",
  "answer",
  "distractors",
  "definition",
  "optionDefinitions",
].sort();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function metadata(question: ReleaseQuestion = questions[0]) {
  const collection = catalogue.collections.find(
    item => item.id === question.collectionId
  )!;
  return {
    releaseVersion: catalogue.releaseVersion,
    collectionLabel: collection.label,
    cefrLevel: collection.cefrLevel,
  };
}

function entry(
  question = questions[0],
  firstMissedAtUtc = FIRST_MISS
): TrickyWordEntry {
  return { question: clone(question), firstMissedAtUtc, ...metadata(question) };
}

function queue(entries: TrickyWordEntry[]): TrickyWordsList {
  return { schemaVersion: 1, entries };
}

function parse(entries: unknown[]): TrickyWordsList {
  return parseTrickyWords(JSON.stringify({ schemaVersion: 1, entries }));
}

function ids(list: TrickyWordsList): string[] {
  return list.entries.map(item => item.question.id);
}

function bytes(list: TrickyWordsList): number {
  return JSON.stringify(list).length * 2;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function withQuestionPadding(
  question: ReleaseQuestion,
  padding: string
): ReleaseQuestion {
  return { ...clone(question), question: question.question + padding };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tricky-word queue contract and public release preservation", () => {
  it("exports the agreed separate key, schema, count and UTF-16 byte limits", () => {
    expect(TRICKY_WORDS_STORAGE_KEY).toBe("kslo.oxbridge.trickyWords.v1");
    expect(MAX_TRICKY_WORDS).toBe(500);
    expect(MAX_TRICKY_WORDS_BYTES).toBe(1_000_000);
    expect(emptyTrickyWords()).toEqual({ schemaVersion: 1, entries: [] });
  });

  it("returns independent empty lists", () => {
    const first = emptyTrickyWords();
    const second = emptyTrickyWords();
    first.entries.push(entry());
    expect(second.entries).toEqual([]);
    expect(parseTrickyWords(null)).toEqual(second);
  });

  it("accepts every current real released question without altering any public value", () => {
    expect(questions.length).toBeGreaterThan(500);
    for (let offset = 0; offset < questions.length; offset += 500) {
      const batch = questions.slice(offset, offset + 500);
      const restored = parse(batch.map(question => entry(question)));
      expect(restored.entries.map(item => item.question)).toEqual(batch);
      expect(bytes(restored)).toBeLessThanOrEqual(MAX_TRICKY_WORDS_BYTES);
      for (const item of restored.entries) {
        expect(Object.keys(item.question).sort()).toEqual(publicFields);
        expect(item).toEqual(entry(item.question));
      }
    }
  });

  it("stores full snapshots including exact sentence-initial, inflected and article-bearing forms", () => {
    const selected = ["ox3000-a1-0281", "ox3000-a1-0008", "ox3000-a1-0040"].map(
      id => questions.find(question => question.id === id)!
    );
    expect(selected.every(Boolean)).toBe(true);
    const list = selected.reduce(
      (current, question) =>
        addTrickyWord(current, question, metadata(question), FIRST_MISS),
      emptyTrickyWords()
    );
    expect(list.entries.map(item => item.question.answer)).toEqual([
      "Everyone",
      "activities",
      "an apple",
    ]);
    expect(list.entries.map(item => item.question)).toEqual(selected);
    expect(parseTrickyWords(JSON.stringify(list))).toEqual(list);
  });

  it("strips exercise options and all unknown/private fields from questions, entries and envelopes", () => {
    const original = entry();
    const contaminated = {
      ...original,
      provenance: { source: "must not survive" },
      question: {
        ...original.question,
        options: [
          original.question.answer,
          ...original.question.distractors,
        ].reverse(),
        pos_raw: "must not survive",
        arbitrary: { nested: true },
      },
    };
    const restored = parseTrickyWords(
      JSON.stringify({
        schemaVersion: 1,
        entries: [contaminated],
        secret: true,
      })
    );
    expect(restored).toEqual(queue([original]));
    expect(Object.keys(restored).sort()).toEqual(["entries", "schemaVersion"]);
    expect(Object.keys(restored.entries[0].question).sort()).toEqual(
      publicFields
    );

    const added = addTrickyWord(
      emptyTrickyWords(),
      contaminated.question,
      metadata(),
      FIRST_MISS
    );
    expect(added).toEqual(queue([original]));
    expect(contaminated.question.options).toHaveLength(4);
  });

  it("has no browser storage or fetch side effects", () => {
    const getItem = vi.fn(() => {
      throw new Error("storage blocked");
    });
    const setItem = vi.fn(() => {
      throw new Error("storage blocked");
    });
    const removeItem = vi.fn(() => {
      throw new Error("storage blocked");
    });
    const fetch = vi.fn(() => {
      throw new Error("network unavailable");
    });
    vi.stubGlobal("localStorage", { getItem, setItem, removeItem });
    vi.stubGlobal("fetch", fetch);
    const added = addTrickyWord(
      emptyTrickyWords(),
      questions[0],
      metadata(),
      FIRST_MISS
    );
    const restored = parseTrickyWords(JSON.stringify(added));
    expect(buildTrickyWordsExercise(restored).questions[0].id).toBe(
      questions[0].id
    );
    expect(removeTrickyWord(restored, questions[0].id)).toEqual(
      emptyTrickyWords()
    );
    for (const operation of [getItem, setItem, removeItem, fetch])
      expect(operation).not.toHaveBeenCalled();
  });
});

describe("untrusted queue validation", () => {
  it.each([
    null,
    "",
    "not JSON",
    "{",
    "null",
    "true",
    "0",
    "[]",
    "{}",
    '{"schemaVersion":0,"entries":[]}',
    '{"schemaVersion":2,"entries":[]}',
    '{"schemaVersion":"1","entries":[]}',
    '{"schemaVersion":1}',
    '{"schemaVersion":1,"entries":null}',
    '{"schemaVersion":1,"entries":{}}',
  ])("safely resets missing, corrupt or incompatible storage: %s", raw => {
    expect(parseTrickyWords(raw)).toEqual(emptyTrickyWords());
  });

  it("does not guess how to migrate otherwise populated incompatible envelopes", () => {
    for (const schemaVersion of [undefined, null, 0, 2, 3, "1"]) {
      expect(
        parseTrickyWords(JSON.stringify({ schemaVersion, entries: [entry()] }))
      ).toEqual(emptyTrickyWords());
    }
  });

  it.each([null, false, 17, "word", [], {}])(
    "skips malformed entries without losing valid neighbours: %j",
    bad => {
      expect(parse([entry(questions[0]), bad, entry(questions[1])])).toEqual(
        queue([entry(questions[0]), entry(questions[1])])
      );
    }
  );

  it.each([
    "question",
    "firstMissedAtUtc",
    "releaseVersion",
    "collectionLabel",
    "cefrLevel",
  ])("rejects a missing, null, blank or wrong-type entry field: %s", field => {
    for (const bad of [undefined, null, "", "   ", 3, [], {}]) {
      const malformed = { ...entry(), [field]: bad };
      expect(parse([malformed]).entries).toEqual([]);
    }
  });

  it.each([
    "id",
    "headword",
    "partOfSpeech",
    "collectionId",
    "segmentId",
    "question",
    "answer",
    "definition",
  ])(
    "rejects a missing, blank or wrong-type public question field: %s",
    field => {
      for (const bad of [undefined, null, "", "\n \t", 5, false, [], {}]) {
        const malformed = entry();
        (malformed.question as unknown as Record<string, unknown>)[field] = bad;
        expect(
          parse([malformed]).entries,
          `${field}: ${JSON.stringify(bad)}`
        ).toEqual([]);
      }
    }
  );

  it.each([
    "2026-11-18",
    "not a date",
    "2026-11-18T01:02:03",
    "2026-11-18T01:02:03+08:00",
    "2026-02-30T01:02:03.000Z",
    "2026-13-18T01:02:03.000Z",
    "2026-11-18T24:02:03.000Z",
    "2026-11-18T01:02:60.000Z",
    "2026-11-18T01:02:03.0000Z",
  ])(
    "rejects non-UTC, impossible or malformed first-miss timestamps: %s",
    date => {
      expect(parse([entry(questions[0], date)]).entries).toEqual([]);
    }
  );

  it("accepts UTC timestamps at second and millisecond precision without rewriting them", () => {
    for (const date of [
      "2026-11-18T01:02:03Z",
      "2026-11-18T01:02:03.1Z",
      "2026-11-18T01:02:03.01Z",
      FIRST_MISS,
    ]) {
      expect(
        parse([entry(questions[0], date)]).entries[0].firstMissedAtUtc
      ).toBe(date);
    }
  });

  it.each([
    { id: "unrelated-0001" },
    { id: "ox3000-a1-provenance" },
    { collectionId: "../ox3000-a1" },
    { segmentId: "ox3000-a2-p1" },
    { segmentId: "ox3000-a1-p3" },
    { question: "No placeholder remains" },
    { question: "Two {BLANK} placeholders {BLANK}" },
    { distractors: null },
    { distractors: "before,during,across" },
    { distractors: ["before", "during"] },
    { distractors: ["before", "during", "across", "after"] },
    { distractors: ["before", "during", " "] },
    { distractors: ["before", "during", 7] },
    { distractors: ["about", "during", "across"] },
    { distractors: [" ABOUT ", "during", "across"] },
    { optionDefinitions: null },
    { optionDefinitions: [] },
    { optionDefinitions: {} },
  ])(
    "rejects malformed IDs, classifications, blanks and option sets: %j",
    patch => {
      const malformed = entry();
      Object.assign(malformed.question, patch);
      expect(parse([malformed]).entries).toEqual([]);
    }
  );

  it("requires exact own definition keys, non-empty string values and the identical target definition", () => {
    const original = entry();
    const answer = original.question.answer;
    const wrong = original.question.distractors[0];
    const variants = [
      {
        ...original.question.optionDefinitions,
        extra: original.question.definition,
      },
      { ...original.question.optionDefinitions, [wrong]: " " },
      { ...original.question.optionDefinitions, [wrong]: 2 },
      {
        ...original.question.optionDefinitions,
        [answer]: "different definition",
      },
      Object.fromEntries(
        Object.entries(original.question.optionDefinitions).filter(
          ([key]) => key !== wrong
        )
      ),
      Object.fromEntries(
        Object.entries(original.question.optionDefinitions).map(
          ([key, value]) => [key.toUpperCase(), value]
        )
      ),
    ];
    for (const optionDefinitions of variants) {
      expect(
        parse([
          {
            ...original,
            question: { ...original.question, optionDefinitions },
          },
        ]).entries
      ).toEqual([]);
    }
  });

  it("rejects a lower-cased sentence-initial option instead of silently repairing it", () => {
    const malformed = entry(
      questions.find(question => question.id === "ox3000-a1-0281")!
    );
    const previous = malformed.question.distractors[0];
    const lower = previous.toLowerCase();
    malformed.question.distractors[0] = lower;
    malformed.question.optionDefinitions[lower] =
      malformed.question.optionDefinitions[previous];
    delete malformed.question.optionDefinitions[previous];
    expect(parse([malformed]).entries).toEqual([]);
  });

  it("does not inherit required fields or prototype definition values in direct helper inputs", () => {
    const inheritedQuestion = Object.create(questions[0]) as ReleaseQuestion;
    expect(
      addTrickyWord(
        emptyTrickyWords(),
        inheritedQuestion,
        metadata(),
        FIRST_MISS
      )
    ).toEqual(emptyTrickyWords());
    const inheritedDefinitions = clone(questions[0]);
    inheritedDefinitions.optionDefinitions = Object.create(
      inheritedDefinitions.optionDefinitions
    );
    expect(
      addTrickyWord(
        emptyTrickyWords(),
        inheritedDefinitions,
        metadata(),
        FIRST_MISS
      )
    ).toEqual(emptyTrickyWords());
    const inheritedList = Object.create(queue([entry()])) as TrickyWordsList;
    expect(removeTrickyWord(inheritedList, "not present")).toEqual(
      emptyTrickyWords()
    );
  });

  it("rejects sparse distractor arrays in direct inputs without throwing or replacing the queue", () => {
    const original = queue([entry()]);
    const malformed = {
      ...clone(questions[1]),
      distractors: new Array(3) as [string, string, string],
    };
    expect(addTrickyWord(original, malformed, metadata(), LATER_MISS)).toEqual(
      original
    );
  });

  it("ignores JSON prototype-pollution keys and never mutates Object.prototype", () => {
    const raw = JSON.stringify(queue([entry()]));
    const contaminated = raw.replace(
      '{"schemaVersion":1,',
      '{"__proto__":{"polluted":true},"schemaVersion":1,'
    );
    expect(parseTrickyWords(contaminated)).toEqual(queue([entry()]));
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects an invalid incoming question or timestamp without evicting existing valid questions", () => {
    const original = queue([entry()]);
    const before = JSON.stringify(original);
    expect(
      addTrickyWord(
        original,
        { ...questions[1], partOfSpeech: "" },
        metadata(),
        LATER_MISS
      )
    ).toEqual(original);
    expect(
      addTrickyWord(original, questions[1], metadata(), "invalid date")
    ).toEqual(original);
    expect(
      addTrickyWord(
        original,
        questions[1],
        { ...metadata(), releaseVersion: " " },
        LATER_MISS
      )
    ).toEqual(original);
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("first-miss identity, ordering and repeat misses", () => {
  it("deduplicates stable IDs, not headwords", () => {
    expect(questions[0].headword).toBe(questions[1].headword);
    expect(questions[0].id).not.toBe(questions[1].id);
    let list = addTrickyWord(
      emptyTrickyWords(),
      questions[0],
      metadata(),
      FIRST_MISS
    );
    list = addTrickyWord(list, questions[1], metadata(), LATER_MISS);
    list = addTrickyWord(list, questions[0], metadata(), LATER_MISS);
    expect(ids(list)).toEqual([questions[0].id, questions[1].id]);
    expect(list.entries[0].firstMissedAtUtc).toBe(FIRST_MISS);
  });

  it("repeated misses refresh public content and source metadata but retain the original timestamp and tie position", () => {
    const list = queue([entry(questions[0]), entry(questions[1])]);
    const updatedQuestion = {
      ...clone(questions[0]),
      partOfSpeech: questions[1].partOfSpeech,
    };
    const source = {
      ...metadata(),
      releaseVersion: "20261119.0900",
      collectionLabel: "Oxford 3000 A1 (updated)",
    };
    const before = JSON.stringify(list);
    const updated = addTrickyWord(list, updatedQuestion, source, LATER_MISS);
    expect(ids(updated)).toEqual(ids(list));
    expect(updated.entries[0]).toEqual({
      question: updatedQuestion,
      firstMissedAtUtc: FIRST_MISS,
      ...source,
    });
    expect(JSON.stringify(list)).toBe(before);
    const clockMovedBackwards = addTrickyWord(
      updated,
      updatedQuestion,
      source,
      "2026-01-01T00:00:00.000Z"
    );
    expect(clockMovedBackwards).toEqual(updated);
  });

  it("preserves the first date and order through repeated serialise/parse/miss cycles", () => {
    let list = queue([
      entry(questions[0]),
      entry(questions[1]),
      entry(questions[2]),
    ]);
    for (let count = 0; count < 6; count += 1) {
      list = addTrickyWord(
        parseTrickyWords(JSON.stringify(list)),
        questions[1],
        metadata(),
        LATER_MISS
      );
      expect(ids(list)).toEqual(
        questions.slice(0, 3).map(question => question.id)
      );
      expect(
        list.entries.every(item => item.firstMissedAtUtc === FIRST_MISS)
      ).toBe(true);
    }
  });

  it("sorts unsorted timestamps chronologically and keeps stable ties including differing UTC precision", () => {
    const list = parse([
      entry(questions[0], LATER_MISS),
      entry(questions[1], "2026-11-18T01:02:03Z"),
      entry(questions[2], FIRST_MISS),
      entry(questions[3], "2026-11-18T01:02:03.1Z"),
      entry(questions[4], "2026-11-18T01:02:03.020Z"),
    ]);
    expect(ids(list)).toEqual(
      [1, 2, 4, 3, 0].map(index => questions[index].id)
    );
    const backdated = addTrickyWord(
      list,
      questions[5],
      metadata(),
      "2026-11-17T00:00:00.000Z"
    );
    expect(ids(backdated)).toEqual([questions[5].id, ...ids(list)]);
  });

  it("salvages duplicate persisted IDs using earliest first miss and latest valid content", () => {
    const latest = entry(questions[0], LATER_MISS);
    latest.releaseVersion = "20261119.0900";
    const middle = entry(questions[1], FIRST_MISS);
    const earliest = entry(questions[0], "2026-11-17T00:00:00.000Z");
    const last = {
      ...latest,
      question: { ...latest.question, partOfSpeech: questions[1].partOfSpeech },
    };
    const restored = parse([
      latest,
      middle,
      earliest,
      last,
      { ...latest, firstMissedAtUtc: "bad" },
    ]);
    expect(ids(restored)).toEqual([questions[0].id, questions[1].id]);
    expect(restored.entries[0]).toEqual({
      ...last,
      firstMissedAtUtc: earliest.firstMissedAtUtc,
    });
  });

  it("defaults a new first miss to the current UTC time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(LATER_MISS));
    expect(
      addTrickyWord(emptyTrickyWords(), questions[0], metadata()).entries[0]
        .firstMissedAtUtc
    ).toBe(LATER_MISS);
  });
});

describe("bounded count and estimated UTF-16 storage", () => {
  it("keeps 500 real unique questions and deletes the oldest when question 501 is added", () => {
    const original = queue(
      questions.slice(0, 500).map(question => entry(question))
    );
    expect(bytes(original)).toBeLessThan(MAX_TRICKY_WORDS_BYTES);
    expect(parseTrickyWords(JSON.stringify(original))).toEqual(original);
    const next = addTrickyWord(
      original,
      questions[500],
      metadata(questions[500]),
      LATER_MISS
    );
    expect(next.entries).toHaveLength(500);
    expect(ids(next)).toEqual(
      questions.slice(1, 501).map(question => question.id)
    );
    expect(original.entries).toHaveLength(500);
    expect(original.entries[0].question.id).toBe(questions[0].id);
  });

  it("deduplicates before count pruning and does not prune when an existing question is missed again", () => {
    const full = queue(
      questions.slice(0, 500).map(question => entry(question))
    );
    const duplicate = entry(questions[0], LATER_MISS);
    expect(ids(parse([...full.entries, duplicate]))).toEqual(ids(full));
    expect(
      ids(addTrickyWord(full, questions[0], metadata(), LATER_MISS))
    ).toEqual(ids(full));
  });

  it("normalises an oversized out-of-order stored queue before removing the chronological oldest", () => {
    const all = questions
      .slice(0, 501)
      .map((question, index) =>
        entry(question, index === 500 ? "2026-01-01T00:00:00.000Z" : FIRST_MISS)
      );
    const result = parse(all);
    expect(ids(result)).toEqual(
      questions.slice(0, 500).map(question => question.id)
    );
  });

  it("prunes by exact serialised UTF-16 byte estimate, including non-BMP text", () => {
    const padded = questions
      .slice(0, 3)
      .map(question => withQuestionPadding(question, "🦉".repeat(90_000)));
    const entries = padded.map(question => entry(question));
    expect(bytes(queue(entries.slice(0, 2)))).toBeLessThan(
      MAX_TRICKY_WORDS_BYTES
    );
    expect(bytes(queue(entries))).toBeGreaterThan(MAX_TRICKY_WORDS_BYTES);
    const original = queue(entries.slice(0, 2));
    const result = addTrickyWord(
      original,
      padded[2],
      metadata(padded[2]),
      LATER_MISS
    );
    expect(ids(result)).toEqual([padded[1].id, padded[2].id]);
    expect(bytes(result)).toBeLessThanOrEqual(MAX_TRICKY_WORDS_BYTES);
    expect(ids(parse(entries))).toEqual(ids(result));
    expect(original.entries).toHaveLength(2);
  });

  it("includes envelope overhead at the exact byte boundary and safely skips one code unit over", () => {
    const original = entry();
    const paddingCount =
      (MAX_TRICKY_WORDS_BYTES - bytes(queue([original]))) / 2;
    expect(Number.isInteger(paddingCount)).toBe(true);
    const exact = withQuestionPadding(
      original.question,
      "x".repeat(paddingCount)
    );
    const exactList = addTrickyWord(
      emptyTrickyWords(),
      exact,
      metadata(),
      FIRST_MISS
    );
    expect(exactList.entries).toHaveLength(1);
    expect(bytes(exactList)).toBe(MAX_TRICKY_WORDS_BYTES);
    expect(parseTrickyWords(JSON.stringify(exactList))).toEqual(exactList);
    const oversized = withQuestionPadding(exact, "x");
    const retained = queue([entry(questions[1])]);
    expect(addTrickyWord(retained, oversized, metadata(), LATER_MISS)).toEqual(
      retained
    );
    expect(parse([entry(oversized), entry(questions[1])])).toEqual(retained);
  });

  it("does not let an oversized repeated miss erase the existing snapshot or its neighbours", () => {
    const original = queue([entry(questions[0]), entry(questions[1])]);
    const oversized = withQuestionPadding(
      questions[0],
      "x".repeat(MAX_TRICKY_WORDS_BYTES)
    );
    expect(addTrickyWord(original, oversized, metadata(), LATER_MISS)).toEqual(
      original
    );
    expect(parse([...original.entries, entry(oversized, LATER_MISS)])).toEqual(
      original
    );
  });

  it("also bounds source metadata, not just question text", () => {
    const original = queue([entry()]);
    const hugeMetadata = {
      ...metadata(),
      collectionLabel: "x".repeat(MAX_TRICKY_WORDS_BYTES),
    };
    expect(
      addTrickyWord(original, questions[1], hugeMetadata, LATER_MISS)
    ).toEqual(original);
  });
});

describe("removal and mutation isolation", () => {
  it("removes only the requested stable ID, retaining the other same-headword item and timestamps", () => {
    const original = queue([
      entry(questions[0]),
      entry(questions[1], LATER_MISS),
      entry(questions[2], LATER_MISS),
    ]);
    const before = JSON.stringify(original);
    const result = removeTrickyWord(original, questions[0].id);
    expect(result).toEqual(queue(original.entries.slice(1)));
    expect(JSON.stringify(original)).toBe(before);
    expect(removeTrickyWord(result, "missing-id")).toEqual(result);
    expect(removeTrickyWord(result, questions[1].id).entries).toEqual([
      original.entries[2],
    ]);
    expect(removeTrickyWord(queue([entry()]), questions[0].id)).toEqual(
      emptyTrickyWords()
    );
    expect(removeTrickyWord(emptyTrickyWords(), questions[0].id)).toEqual(
      emptyTrickyWords()
    );
  });

  it("does not share question arrays or definition maps with inputs, previous lists or removed-list copies", () => {
    const question = clone(questions[0]);
    const before = JSON.stringify(question);
    const first = addTrickyWord(
      emptyTrickyWords(),
      question,
      metadata(),
      FIRST_MISS
    );
    expect(first.entries[0].question).not.toBe(question);
    expect(first.entries[0].question.distractors).not.toBe(
      question.distractors
    );
    expect(first.entries[0].question.optionDefinitions).not.toBe(
      question.optionDefinitions
    );
    const next = addTrickyWord(first, questions[1], metadata(), LATER_MISS);
    const firstBefore = JSON.stringify(first);
    const removedCopy = removeTrickyWord(next, "absent");
    expect(removedCopy.entries[0]).not.toBe(next.entries[0]);
    expect(removedCopy.entries[0].question.distractors).not.toBe(
      next.entries[0].question.distractors
    );
    expect(removedCopy.entries[0].question.optionDefinitions).not.toBe(
      next.entries[0].question.optionDefinitions
    );
    removedCopy.entries[0].question.distractors.reverse();
    removedCopy.entries[0].question.optionDefinitions[question.answer] =
      "changed";
    removedCopy.entries[0].firstMissedAtUtc = LATER_MISS;
    next.entries[0].question.headword = "changed";
    next.entries.reverse();
    expect(JSON.stringify(first)).toBe(firstBefore);
    expect(JSON.stringify(question)).toBe(before);
  });

  it("handles frozen queue and question inputs without mutating them", () => {
    const source = clone(questions[0]);
    Object.freeze(source.distractors);
    Object.freeze(source.optionDefinitions);
    Object.freeze(source);
    const list = queue([entry(questions[1])]);
    Object.freeze(list.entries[0].question.distractors);
    Object.freeze(list.entries[0].question.optionDefinitions);
    Object.freeze(list.entries[0].question);
    Object.freeze(list.entries[0]);
    Object.freeze(list.entries);
    Object.freeze(list);
    expect(
      addTrickyWord(list, source, metadata(), LATER_MISS).entries
    ).toHaveLength(2);
    expect(removeTrickyWord(list, source.id)).toEqual(list);
    expect(buildTrickyWordsExercise(list).questions).toHaveLength(1);
  });
});

describe("oldest-first tricky-word exercise snapshots", () => {
  it("builds the complete schema-v2 practice selection and resets UUID, clock and progress", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(LATER_MISS));
    const sessionId = "f19c60fa-d2bb-4a40-b7e0-216a28c06481";
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(sessionId);
    const list = queue(questions.slice(0, 3).map(question => entry(question)));
    const snapshot = buildTrickyWordsExercise(list, seededRandom(12));
    expect(uuid).toHaveBeenCalledOnce();
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      kind: "tricky-words",
      releaseVersion: catalogue.releaseVersion,
      sessionId,
      status: "active",
      selection: {
        collectionId: "tricky-words",
        collectionLabel: "Incorrect questions",
        segmentMode: "tricky-words",
        segmentLabel: "Oldest first",
        rangeLabel: "Questions missed on the first attempt",
        cefrLevel: "A1",
        requestedCount: 3,
      },
      currentIndex: 0,
      score: 0,
      elapsedMs: 0,
      savedAtUtc: LATER_MISS,
    });
    expect(snapshot.questionProgress).toEqual(
      list.entries.map(() => ({
        attemptedOptions: [],
        lastSelectedOption: null,
        resolved: false,
        firstAttemptCorrect: false,
      }))
    );
    expect(ids(list)).toEqual(snapshot.questions.map(question => question.id));
  });

  it("supports zero, single and odd queues rather than applying regular full-list balance rules", () => {
    for (const count of [0, 1, 3, 7]) {
      const list = queue(
        questions.slice(0, count).map(question => entry(question))
      );
      const snapshot = buildTrickyWordsExercise(list);
      expect(snapshot.selection.requestedCount).toBe(count);
      expect(snapshot.questions).toHaveLength(count);
      expect(snapshot.questionProgress).toHaveLength(count);
      expect(snapshot.selection.cefrLevel).toBe(count ? "A1" : "Mixed");
      expect(snapshot.currentIndex).toBe(0);
      expect(snapshot.score).toBe(0);
      expect(snapshot.elapsedMs).toBe(0);
      expect(snapshot.releaseVersion).toBeTruthy();
    }
    const collection = catalogue.collections[0];
    expect(() =>
      buildExercise(collection, "full", 3, {}, catalogue.releaseVersion)
    ).toThrow("even question count");
  });

  it("derives CEFR from unique source levels, not collection count, and describes mixed release versions", () => {
    const b2Collections = catalogue.collections.filter(
      collection => collection.cefrLevel === "B2"
    );
    expect(b2Collections).toHaveLength(2);
    const b2Entries = b2Collections.map(collection =>
      entry(
        questions.find(question => question.collectionId === collection.id)!
      )
    );
    expect(buildTrickyWordsExercise(queue(b2Entries)).selection.cefrLevel).toBe(
      "B2"
    );
    const mixed = queue([entry(questions[0]), ...b2Entries]);
    mixed.entries[1].releaseVersion = "20261119.0900";
    const snapshot = buildTrickyWordsExercise(mixed);
    expect(snapshot.selection.cefrLevel).toBe("Mixed");
    expect(snapshot.releaseVersion).toMatch(/mixed.*release/i);
    expect(snapshot.questions.map(question => question.id)).toEqual(ids(mixed));
    expect(snapshot.selection.requestedCount).toBe(3);
  });

  it("orders all questions oldest first without consuming randomness on question order", () => {
    const list = queue([
      entry(questions[0], LATER_MISS),
      entry(questions[1], FIRST_MISS),
      entry(questions[2], FIRST_MISS),
    ]);
    const random = vi.fn(() => 0);
    const snapshot = buildTrickyWordsExercise(list, random);
    expect(snapshot.questions.map(question => question.id)).toEqual(
      [1, 2, 0].map(index => questions[index].id)
    );
    expect(random).toHaveBeenCalledTimes(3 * 3);
    for (const question of snapshot.questions) {
      const [first, second, third] = question.distractors;
      expect(question.options).toEqual([first, second, third, question.answer]);
    }
  });

  it("retains exact four stored forms and definitions across mixed real collections", () => {
    const list = queue(
      catalogue.collections.map(collection =>
        entry(
          questions.find(question => question.collectionId === collection.id)!
        )
      )
    );
    const snapshot = buildTrickyWordsExercise(list, seededRandom(14));
    expect(snapshot.questions).toHaveLength(catalogue.collections.length);
    snapshot.questions.forEach((question, index) => {
      const { options, ...publicQuestion } = question;
      expect(publicQuestion).toEqual(list.entries[index].question);
      expect(options).toHaveLength(4);
      expect(new Set(options).size).toBe(4);
      expect([...options].sort()).toEqual(
        [question.answer, ...question.distractors].sort()
      );
      expect(Object.keys(question.optionDefinitions).sort()).toEqual(
        [...options].sort()
      );
      expect(question.optionDefinitions[question.answer]).toBe(
        question.definition
      );
    });
  });

  it("constructs from stored public snapshots only and discards malformed or duplicate direct entries", () => {
    const list = queue([
      entry(questions[0]),
      entry(questions[0], LATER_MISS),
      entry(questions[1]),
    ]);
    list.entries.push({
      ...entry(questions[2]),
      question: { ...questions[2], definition: "" },
    });
    const snapshot = buildTrickyWordsExercise(list);
    expect(snapshot.questions.map(question => question.id)).toEqual([
      questions[0].id,
      questions[1].id,
    ]);
    expect(snapshot.selection.requestedCount).toBe(2);
    expect(snapshot.questionProgress).toHaveLength(2);
  });

  it("creates independent nested arrays, maps and per-question progress across sessions", () => {
    const list = queue(questions.slice(0, 3).map(question => entry(question)));
    const before = JSON.stringify(list);
    const first = buildTrickyWordsExercise(list, seededRandom(1));
    const second = buildTrickyWordsExercise(list, seededRandom(2));
    const secondBefore = JSON.stringify(second);
    expect(first.sessionId).not.toBe(second.sessionId);
    first.questions.forEach((question, index) => {
      expect(question).not.toBe(list.entries[index].question);
      expect(question.distractors).not.toBe(
        list.entries[index].question.distractors
      );
      expect(question.optionDefinitions).not.toBe(
        list.entries[index].question.optionDefinitions
      );
      expect(question.options).not.toBe(second.questions[index].options);
      if (index > 0) {
        expect(first.questionProgress[index]).not.toBe(
          first.questionProgress[0]
        );
        expect(first.questionProgress[index].attemptedOptions).not.toBe(
          first.questionProgress[0].attemptedOptions
        );
      }
    });
    first.questions[0].distractors.reverse();
    first.questions[0].options.reverse();
    first.questions[0].optionDefinitions[first.questions[0].answer] = "changed";
    first.questionProgress[0].attemptedOptions.push(first.questions[0].answer);
    first.questionProgress[0].resolved = true;
    first.questions.reverse();
    expect(JSON.stringify(list)).toBe(before);
    expect(JSON.stringify(second)).toBe(secondBefore);
    expect(first.questionProgress[1].attemptedOptions).toEqual([]);
  });

  it("round-trips exact option order and active scoring state without reshuffling for resume", () => {
    const list = queue(questions.slice(0, 3).map(question => entry(question)));
    const random = vi.fn(seededRandom(31));
    const snapshot = buildTrickyWordsExercise(list, random);
    const question = snapshot.questions[0];
    const wrong = applyAttempt(
      question.answer,
      snapshot.questionProgress[0],
      snapshot.score,
      question.distractors[0]
    );
    snapshot.questionProgress[0] = wrong.progress;
    snapshot.score = wrong.score;
    snapshot.elapsedMs = 3_450;
    const restored = JSON.parse(JSON.stringify(snapshot)) as ExerciseSnapshot;
    expect(restored).toEqual(snapshot);
    expect(restored.questions.map(item => item.options)).toEqual(
      snapshot.questions.map(item => item.options)
    );
    expect(random).toHaveBeenCalledTimes(9);
    const recovery = applyAttempt(
      question.answer,
      restored.questionProgress[0],
      restored.score,
      question.answer
    );
    expect(recovery.score).toBe(0);
    expect(recovery.progress.resolved).toBe(true);
    expect(recovery.progress.firstAttemptCorrect).toBe(false);
  });

  it("supports the existing first-attempt scoring and clear-only-on-correct-first contract", () => {
    let list = queue(questions.slice(0, 3).map(question => entry(question)));
    const snapshot = buildTrickyWordsExercise(list);
    const scoreFirst = (
      question: ExerciseQuestion,
      index: number,
      selected: string,
      score: number
    ) =>
      applyAttempt(
        question.answer,
        snapshot.questionProgress[index],
        score,
        selected
      );
    const correct = scoreFirst(
      snapshot.questions[0],
      0,
      snapshot.questions[0].answer,
      0
    );
    expect(correct.score).toBe(1);
    if (correct.progress.firstAttemptCorrect)
      list = removeTrickyWord(list, snapshot.questions[0].id);
    const wrong = scoreFirst(
      snapshot.questions[1],
      1,
      snapshot.questions[1].distractors[0],
      correct.score
    );
    expect(wrong.score).toBe(1);
    list = addTrickyWord(
      list,
      snapshot.questions[1],
      metadata(snapshot.questions[1]),
      LATER_MISS
    );
    const recovered = applyAttempt(
      snapshot.questions[1].answer,
      wrong.progress,
      wrong.score,
      snapshot.questions[1].answer
    );
    expect(recovered.score).toBe(1);
    expect(recovered.progress.firstAttemptCorrect).toBe(false);
    expect(ids(list)).toEqual([questions[1].id, questions[2].id]);
    expect(list.entries.map(item => item.firstMissedAtUtc)).toEqual([
      FIRST_MISS,
      FIRST_MISS,
    ]);
    expect(snapshot.questionProgress[2].attemptedOptions).toEqual([]);
    const remainingSession = buildTrickyWordsExercise(list);
    expect(remainingSession.questions.map(question => question.id)).toEqual(
      ids(list)
    );
    expect(remainingSession.score).toBe(0);
    expect(list.entries[0].question).not.toHaveProperty("options");
  });
});
