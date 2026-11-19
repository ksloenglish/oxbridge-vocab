import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addTrickyWord,
  emptyTrickyWords,
  TRICKY_WORDS_STORAGE_KEY,
} from "./trickyWords";
import {
  readTrickyWordsStorage,
  writeTrickyWordsStorage,
} from "./trickyWordsStorage";
import type { BrowserStorage } from "./trickyWordsStorage";
import type { ReleaseCatalogue, SegmentRelease } from "@/types";

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
function listOf(count: number) {
  return questions
    .slice(0, count)
    .reduce(
      (list, question, index) =>
        addTrickyWord(
          list,
          question,
          metadata,
          new Date(Date.UTC(2026, 10, 19, 0, 0, index)).toISOString()
        ),
      emptyTrickyWords()
    );
}
function fakeStorage(limit = Infinity) {
  const values = new Map<string, string>([["other-app", "leave this alone"]]);
  const storage: BrowserStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (value.length > limit) {
        const error = new Error("Quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, value);
    },
    removeItem: key => {
      values.delete(key);
    },
  };
  return { values, storage };
}

describe("browser-only tricky-word storage", () => {
  it("round-trips real saved questions in a separate versioned key", () => {
    const { storage, values } = fakeStorage();
    const list = listOf(3);
    const saved = writeTrickyWordsStorage(list, storage);
    expect(saved.persisted).toBe(true);
    expect(saved.warning).toBeNull();
    expect(readTrickyWordsStorage(storage).list).toEqual(list);
    expect(values.has(TRICKY_WORDS_STORAGE_KEY)).toBe(true);
    expect(values.get("other-app")).toBe("leave this alone");
  });

  it("trims only oldest questions on quota pressure and reports it", () => {
    const list = listOf(10);
    const { storage, values } = fakeStorage(JSON.stringify(list).length * 0.6);
    const result = writeTrickyWordsStorage(list, storage);
    expect(result.persisted).toBe(true);
    expect(result.warning).toContain("oldest");
    expect(result.list.entries.length).toBeGreaterThan(0);
    expect(result.list.entries.length).toBeLessThan(10);
    expect(result.list.entries).toEqual(
      list.entries.slice(-result.list.entries.length)
    );
    expect(readTrickyWordsStorage(storage).list).toEqual(result.list);
    expect(list.entries).toHaveLength(10);
    expect(values.get("other-app")).toBe("leave this alone");
  });

  it("retains the full in-memory list if not even one entry fits", () => {
    const list = listOf(2);
    const { storage } = fakeStorage(1);
    const result = writeTrickyWordsStorage(list, storage);
    expect(result.persisted).toBe(false);
    expect(result.list).toBe(list);
    expect(result.warning).toContain("this visit only");
  });

  it("handles completely blocked storage without a crash", () => {
    const list = listOf(1);
    expect(readTrickyWordsStorage(null).persisted).toBe(false);
    expect(writeTrickyWordsStorage(list, null)).toMatchObject({
      list,
      persisted: false,
    });
    const blocked = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    };
    expect(() => readTrickyWordsStorage(blocked)).not.toThrow();
    expect(writeTrickyWordsStorage(list, blocked).list).toBe(list);
  });

  it("does not discard old entries for a non-quota write failure", () => {
    const list = listOf(10);
    let writes = 0;
    const storage: BrowserStorage = {
      getItem: () => null,
      setItem: () => {
        writes++;
        throw new Error("Permission denied");
      },
      removeItem: () => {
        throw new Error("Must not clear other storage");
      },
    };
    expect(writeTrickyWordsStorage(list, storage).list).toBe(list);
    expect(writes).toBe(1);
  });

  it("recovers safely from corrupt or future-schema data", () => {
    const { values, storage } = fakeStorage();
    values.set(TRICKY_WORDS_STORAGE_KEY, "{broken");
    expect(readTrickyWordsStorage(storage).list).toEqual(emptyTrickyWords());
    values.set(
      TRICKY_WORDS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 99, entries: [] })
    );
    expect(readTrickyWordsStorage(storage).list).toEqual(emptyTrickyWords());
    expect(values.get("other-app")).toBe("leave this alone");
  });
});
