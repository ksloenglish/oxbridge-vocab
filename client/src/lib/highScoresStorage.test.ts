import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIGH_SCORES_STORAGE_KEY,
  addHighScore,
  emptyHighScores,
  type HighScoreEntry,
  type HighScoresList,
} from "./highScores";
import {
  clearHighScoresStorage,
  readHighScoresStorage,
  writeHighScoresStorage,
} from "./highScoresStorage";
import { browserStorage, type BrowserStorage } from "./trickyWordsStorage";

const OTHER_KEYS = [
  "other-app",
  "kslo.oxbridge.savedExercise.v1",
  "kslo.oxbridge.trickyWords.v1",
  "kslo.oxbridge.setupPreference.v1",
];
function entry(index = 0): HighScoreEntry {
  return {
    sessionId: `session-${index}`,
    collectionId: "ox3000-a1",
    questionCount: 10,
    correctFirst: 8,
    elapsedMs: 1000 + index / 1000,
    completedAtUtc: "2026-11-19T09:10:11.123Z",
    segmentLabel: "Full list",
    rangeLabel: "Words 1–900 (a – zoo)",
  };
}
function listOf(count = 10): HighScoresList {
  return Array.from({ length: count }, (_, index) => entry(index)).reduce(
    addHighScore,
    emptyHighScores()
  );
}
function fakeStorage(limit = Infinity, errorName = "QuotaExceededError") {
  const values = new Map<string, string>(
    OTHER_KEYS.map(key => [key, `untouched:${key}`])
  );
  const storage: BrowserStorage = {
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => {
      if (value.length > limit) {
        const error = new Error("Details must not be leaked to students");
        error.name = errorName;
        throw error;
      }
      values.set(key, value);
    }),
    removeItem: vi.fn(key => {
      values.delete(key);
    }),
  };
  return { values, storage };
}
function expectUnrelatedKeys(values: Map<string, string>) {
  for (const key of OTHER_KEYS)
    expect(values.get(key)).toBe(`untouched:${key}`);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("guarded high-score storage", () => {
  it("reads an empty healthy browser without writing or removing anything", () => {
    const { storage, values } = fakeStorage();
    expect(readHighScoresStorage(storage)).toEqual({
      list: emptyHighScores(),
      persisted: true,
      warning: null,
    });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(HIGH_SCORES_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expectUnrelatedKeys(values);
  });
  it("round-trips all ten compact summaries in a dedicated versioned key", () => {
    const { storage, values } = fakeStorage();
    const list = listOf();
    const result = writeHighScoresStorage(list, storage);
    expect(result).toEqual({ list, persisted: true, warning: null });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify(list)
    );
    expect(readHighScoresStorage(storage)).toEqual(result);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expectUnrelatedKeys(values);
  });
  it("projects only validated public summary fields before writing, never question snapshots", () => {
    const { storage, values } = fakeStorage();
    const contaminated = {
      schemaVersion: 1 as const,
      entries: [
        { ...entry(), questions: ["must not persist"], provenance: "private" },
      ],
      secret: true,
    };
    const result = writeHighScoresStorage(contaminated, storage);
    expect(result).toEqual({
      list: { schemaVersion: 1, entries: [entry()] },
      persisted: true,
      warning: null,
    });
    expect(values.get(HIGH_SCORES_STORAGE_KEY)).not.toMatch(
      /questions|provenance|secret|private/
    );
    expectUnrelatedKeys(values);
  });
  it.each([
    "QuotaExceededError",
    "NS_ERROR_DOM_QUOTA_REACHED",
    "SecurityError",
    "Error",
  ])(
    "retains the full intended list after %s without retrying or quota pruning",
    errorName => {
      const list = listOf();
      const { storage, values } = fakeStorage(
        JSON.stringify(list).length * 0.6,
        errorName
      );
      const previous = JSON.stringify(listOf(2));
      values.set(HIGH_SCORES_STORAGE_KEY, previous);
      const before = JSON.stringify(list);
      const result = writeHighScoresStorage(list, storage);
      expect(result.list).toBe(list);
      expect(result.list.entries).toHaveLength(10);
      expect(result.persisted).toBe(false);
      expect(result.warning).toContain("this visit only");
      expect(result.warning).toContain("refreshing");
      expect(result.warning).not.toContain("Details");
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(values.get(HIGH_SCORES_STORAGE_KEY)).toBe(previous);
      expect(JSON.stringify(list)).toBe(before);
      expectUnrelatedKeys(values);
    }
  );
  it("keeps the full in-memory list when even an empty envelope cannot fit", () => {
    const { storage } = fakeStorage(0);
    const list = listOf();
    expect(writeHighScoresStorage(list, storage)).toMatchObject({
      list,
      persisted: false,
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(list.entries).toHaveLength(10);
  });
  it("supports null storage with explicit memory-only warnings", () => {
    const list = listOf();
    expect(readHighScoresStorage(null)).toMatchObject({
      list: emptyHighScores(),
      persisted: false,
    });
    expect(readHighScoresStorage(null).warning).toContain("this visit only");
    const saved = writeHighScoresStorage(list, null);
    expect(saved.list).toBe(list);
    expect(saved.persisted).toBe(false);
    expect(saved.warning).toContain("refreshing");
  });
  it("catches blocked injected reads without performing writes or removals", () => {
    const storage: BrowserStorage = {
      getItem: vi.fn(() => {
        throw new Error("read denied");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(() => readHighScoresStorage(storage)).not.toThrow();
    expect(readHighScoresStorage(storage)).toMatchObject({
      list: emptyHighScores(),
      persisted: false,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it("catches blocked default window.localStorage getters for both read and write", () => {
    const getter = vi.fn(() => {
      throw new Error("SecurityError");
    });
    vi.stubGlobal(
      "window",
      Object.defineProperty({}, "localStorage", { get: getter })
    );
    expect(browserStorage()).toBeNull();
    expect(readHighScoresStorage()).toMatchObject({
      list: emptyHighScores(),
      persisted: false,
    });
    const list = listOf();
    expect(writeHighScoresStorage(list).list).toBe(list);
    expect(writeHighScoresStorage(list).persisted).toBe(false);
    expect(getter).toHaveBeenCalled();
  });
  it("handles server/no-window execution without touching global storage", () => {
    vi.stubGlobal("window", undefined);
    const localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorage);
    expect(readHighScoresStorage().persisted).toBe(false);
    expect(writeHighScoresStorage(listOf()).persisted).toBe(false);
    for (const operation of Object.values(localStorage))
      expect(operation).not.toHaveBeenCalled();
  });
  it("uses the shared browserStorage accessor when storage is not explicitly injected", () => {
    const { storage } = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(writeHighScoresStorage(listOf()).persisted).toBe(true);
    expect(readHighScoresStorage().list).toEqual(listOf());
  });
  it.each([
    "{broken",
    "null",
    "[]",
    '{"schemaVersion":99,"entries":[]}',
    '{"schemaVersion":1,"entries":{}}',
  ])("safely reads corrupt data %s without rewriting or deleting it", raw => {
    const { storage, values } = fakeStorage();
    values.set(HIGH_SCORES_STORAGE_KEY, raw);
    expect(readHighScoresStorage(storage)).toEqual({
      list: emptyHighScores(),
      persisted: true,
      warning: null,
    });
    expect(values.get(HIGH_SCORES_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expectUnrelatedKeys(values);
  });
  it("salvages valid neighbours, strips unknown fields and ranks before returning corrupt mixtures", () => {
    const { storage, values } = fakeStorage();
    values.set(
      HIGH_SCORES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          { ...entry(1), secret: "drop" },
          null,
          { ...entry(2), collectionId: "__proto__" },
          entry(0),
          { ...entry(0), correctFirst: 10 },
        ],
      })
    );
    expect(readHighScoresStorage(storage)).toEqual({
      list: { schemaVersion: 1, entries: [entry(0), entry(1)] },
      persisted: true,
      warning: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expectUnrelatedKeys(values);
  });
  it("catches serialisation errors while preserving the supplied in-memory list", () => {
    const { storage } = fakeStorage();
    const list = listOf();
    Object.defineProperty(list, "toJSON", {
      value: () => {
        throw new Error("bad serializer");
      },
    });
    const result = writeHighScoresStorage(list, storage);
    expect(result.list).toBe(list);
    expect(result.persisted).toBe(false);
    expect(result.warning).toContain("this visit only");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe("clearing only high-score storage", () => {
  it("removes only the high-score key, preserving every other app/exercise key", () => {
    const { storage, values } = fakeStorage();
    values.set(HIGH_SCORES_STORAGE_KEY, JSON.stringify(listOf()));
    expect(clearHighScoresStorage(storage)).toEqual({
      list: emptyHighScores(),
      persisted: true,
      warning: null,
    });
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(storage.removeItem).toHaveBeenCalledWith(HIGH_SCORES_STORAGE_KEY);
    expect(values.has(HIGH_SCORES_STORAGE_KEY)).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expectUnrelatedKeys(values);
  });

  it("is safe and idempotent when history is already empty", () => {
    const { storage, values } = fakeStorage();
    for (let n = 0; n < 2; n++) {
      expect(clearHighScoresStorage(storage).persisted).toBe(true);
    }
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    expectUnrelatedKeys(values);
  });

  it.each(["{broken", '{"schemaVersion":99,"entries":[]}', "null"])(
    "removes unreadable score history %s without needing to parse it",
    raw => {
      const { storage, values } = fakeStorage();
      values.set(HIGH_SCORES_STORAGE_KEY, raw);
      expect(clearHighScoresStorage(storage).persisted).toBe(true);
      expect(values.has(HIGH_SCORES_STORAGE_KEY)).toBe(false);
      expect(storage.getItem).not.toHaveBeenCalled();
      expectUnrelatedKeys(values);
    }
  );

  it("reports visit-only clearing when removal is blocked and preserves persisted history", () => {
    const { storage, values } = fakeStorage();
    const original = JSON.stringify(listOf(2));
    values.set(HIGH_SCORES_STORAGE_KEY, original);
    vi.mocked(storage.removeItem).mockImplementation(() => {
      throw new Error("private removal details");
    });
    const result = clearHighScoresStorage(storage);
    expect(result.list).toEqual(emptyHighScores());
    expect(result.persisted).toBe(false);
    expect(result.warning).toContain("this visit only");
    expect(result.warning).toContain("refreshing");
    expect(result.warning).not.toContain("private removal details");
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(values.get(HIGH_SCORES_STORAGE_KEY)).toBe(original);
    expectUnrelatedKeys(values);
  });

  it("handles null storage and blocked default access without claiming deletion", () => {
    expect(clearHighScoresStorage(null)).toMatchObject({
      list: emptyHighScores(),
      persisted: false,
    });
    vi.stubGlobal(
      "window",
      Object.defineProperty({}, "localStorage", {
        get: () => {
          throw new Error("SecurityError");
        },
      })
    );
    expect(() => clearHighScoresStorage()).not.toThrow();
    expect(clearHighScoresStorage().persisted).toBe(false);
  });

  it("does not require a successful read before performing the explicit removal", () => {
    const { storage, values } = fakeStorage();
    values.set(HIGH_SCORES_STORAGE_KEY, "unreadable history");
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new Error("read blocked");
    });
    expect(clearHighScoresStorage(storage).persisted).toBe(true);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(values.has(HIGH_SCORES_STORAGE_KEY)).toBe(false);
    expectUnrelatedKeys(values);
  });

  it("handles execution without window safely", () => {
    vi.stubGlobal("window", undefined);
    expect(clearHighScoresStorage()).toMatchObject({
      list: emptyHighScores(),
      persisted: false,
    });
  });
});
