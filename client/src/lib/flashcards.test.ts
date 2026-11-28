import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_REMEMBERED_POSITIONS,
  REVISION_POSITION_STORAGE_KEY,
  buildExampleSentence,
  getCardSourceLabel,
  getRevisionSegments,
  readRevisionPosition,
  revisionPositionKey,
  writeRevisionPosition,
} from "./flashcards";
import {
  readSetupPreference,
  resolveSetupPreference,
  writeSetupPreference,
} from "./setupPreference";
import type { ReleaseCatalogue, ReleaseQuestion, SegmentRelease } from "@/types";

const releaseRoot = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(releaseRoot, "catalog.json"), "utf8"),
) as ReleaseCatalogue;
const releases = catalogue.collections.flatMap(collection =>
  collection.segments.map(
    segment =>
      JSON.parse(
        readFileSync(resolve(releaseRoot, segment.dataFile), "utf8"),
      ) as SegmentRelease,
  ),
);
const allQuestions = releases.flatMap(release => release.questions);
const byId = new Map(allQuestions.map(question => [question.id, question]));
const find = (id: string) => byId.get(id) as ReleaseQuestion;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("flash-card example sentences", () => {
  it("rebuilds every released sentence exactly, with one non-empty highlight", () => {
    expect(allQuestions).toHaveLength(catalogue.releasedQuestionCount);
    for (const question of allQuestions) {
      const parts = buildExampleSentence(question);
      expect(parts.map(part => part.text).join("")).toBe(
        question.question.replace("{BLANK}", question.answer),
      );
      const highlighted = parts.filter(part => part.highlight);
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0].text.trim()).not.toBe("");
      expect(question.answer.endsWith(highlighted[0].text)).toBe(true);
    }
  });

  it("highlights the inserted form, including inflections", () => {
    const arched = buildExampleSentence(find("cambridge-c2-0017"));
    expect(arched.find(part => part.highlight)?.text).toBe("arched");
    const taught = buildExampleSentence(find("ox3000-a1-0872"));
    expect(taught.find(part => part.highlight)?.text).toBe("taught");
  });

  it("leaves a grammatical leading article outside the highlight", () => {
    const abrupt = buildExampleSentence(find("cambridge-c2-0001"));
    expect(abrupt.find(part => part.highlight)?.text).toBe("abrupt");
    expect(abrupt.some(part => !part.highlight && part.text.endsWith("an "))).toBe(
      true,
    );
    const sentenceStart = allQuestions.find(
      question =>
        question.question.startsWith("{BLANK}") && /^An /.test(question.answer),
    ) as ReleaseQuestion;
    const parts = buildExampleSentence(sentenceStart);
    expect(parts[0]).toEqual({ text: "An ", highlight: false });
  });

  it("keeps an article that belongs to the headword itself", () => {
    const parts = buildExampleSentence({
      headword: "a",
      answer: "a",
      question: "There is {BLANK} cat.",
    });
    expect(parts.find(part => part.highlight)?.text).toBe("a");
    const phrase = buildExampleSentence({
      headword: "the press",
      answer: "the press",
      question: "She spoke to {BLANK}.",
    });
    expect(phrase.find(part => part.highlight)?.text).toBe("the press");
  });
});

describe("flash-card source labels and ranges", () => {
  it("names the Oxford list only for the two B2 collections", () => {
    const labels = Object.fromEntries(
      catalogue.collections.map(item => [item.id, getCardSourceLabel(item)]),
    );
    expect(labels).toEqual({
      "ox3000-a1": null,
      "ox3000-a2": null,
      "ox3000-b1": null,
      "ox3000-b2": "Oxford 3000",
      "ox5000-b2": "Oxford 5000",
      "ox5000-c1": null,
      "cambridge-c2": null,
    });
  });

  it("uses the selected half, or both halves in order for Full list", () => {
    for (const collection of catalogue.collections) {
      const [first, second] = collection.segments;
      expect(getRevisionSegments(collection, first.id)).toEqual([first]);
      expect(getRevisionSegments(collection, second.id)).toEqual([second]);
      expect(getRevisionSegments(collection, "full")).toEqual([first, second]);
    }
  });

  it("released files are in ID order and match catalogue counts", () => {
    for (const collection of catalogue.collections) {
      for (const segment of collection.segments) {
        const release = releases.find(item => item.segmentId === segment.id);
        const ids = release?.questions.map(question => question.id) ?? [];
        expect(ids).toEqual([...ids].sort());
        expect(ids).toHaveLength(segment.availableCount);
        expect(release?.questions.every(q => q.partOfSpeech.trim() !== "")).toBe(
          true,
        );
      }
    }
  });
});

describe("remembered revision position", () => {
  it("restores only a valid index for the same selection", () => {
    const storage = memoryStorage();
    const key = revisionPositionKey("r1", "ox3000-a1", "full");
    expect(readRevisionPosition(key, 10, storage)).toBe(0);
    writeRevisionPosition(key, 7, storage);
    expect(readRevisionPosition(key, 10, storage)).toBe(7);
    expect(readRevisionPosition(key, 7, storage)).toBe(0);
    expect(
      readRevisionPosition(revisionPositionKey("r1", "ox3000-a1", "x"), 10, storage),
    ).toBe(0);
    const other = revisionPositionKey("r1", "ox3000-a2", "ox3000-a2-p1");
    writeRevisionPosition(other, 3, storage);
    expect(readRevisionPosition(key, 10, storage)).toBe(7);
    expect(readRevisionPosition(other, 10, storage)).toBe(3);
    for (let i = 0; i < MAX_REMEMBERED_POSITIONS; i += 1) {
      writeRevisionPosition(`k${i}`, 1, storage);
    }
    expect(readRevisionPosition(key, 10, storage)).toBe(0);
    expect(readRevisionPosition(`k${MAX_REMEMBERED_POSITIONS - 1}`, 10, storage)).toBe(1);
    storage.values.set(REVISION_POSITION_STORAGE_KEY, "{broken");
    expect(readRevisionPosition(key, 10, storage)).toBe(0);
  });

  it("survives blocked storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeRevisionPosition("k", 1, blocked)).not.toThrow();
    expect(readRevisionPosition("k", 5, blocked)).toBe(0);
  });
});

describe("remembered activity choice", () => {
  it("defaults old preferences to Exercise and keeps a stored Revision choice", () => {
    const storage = memoryStorage();
    storage.setItem(
      "kslo.oxbridge.setupPreference.v1",
      JSON.stringify({ collectionId: "ox3000-b2", mode: "full", count: 20 }),
    );
    const legacy = resolveSetupPreference(catalogue, readSetupPreference(storage));
    expect(legacy.activity).toBe("exercise");
    writeSetupPreference({ ...legacy, activity: "revision" }, storage);
    const restored = resolveSetupPreference(catalogue, readSetupPreference(storage));
    expect(restored).toEqual({
      collectionId: "ox3000-b2",
      mode: "full",
      count: 20,
      activity: "revision",
    });
    storage.setItem(
      "kslo.oxbridge.setupPreference.v1",
      JSON.stringify({ ...restored, activity: "bogus" }),
    );
    expect(
      resolveSetupPreference(catalogue, readSetupPreference(storage)).activity,
    ).toBe("exercise");
  });
});
