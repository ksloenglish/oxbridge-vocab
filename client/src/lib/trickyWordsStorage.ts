/** Browser-only storage boundary: never clear unrelated keys or let storage failures break practice. */
import {
  emptyTrickyWords,
  parseTrickyWords,
  TRICKY_WORDS_STORAGE_KEY,
} from "./trickyWords";
import type { TrickyWordsList } from "./trickyWords";

export type BrowserStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export interface TrickyWordsStorageResult {
  list: TrickyWordsList;
  persisted: boolean;
  warning: string | null;
}

export function browserStorage(): BrowserStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readTrickyWordsStorage(
  storage: BrowserStorage | null = browserStorage()
): TrickyWordsStorageResult {
  try {
    if (!storage) throw new Error("Storage unavailable");
    return {
      list: parseTrickyWords(storage.getItem(TRICKY_WORDS_STORAGE_KEY)),
      persisted: true,
      warning: null,
    };
  } catch {
    return {
      list: emptyTrickyWords(),
      persisted: false,
      warning:
        "Browser storage is unavailable. Incorrect questions will be kept for this visit only.",
    };
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

export function writeTrickyWordsStorage(
  list: TrickyWordsList,
  storage: BrowserStorage | null = browserStorage()
): TrickyWordsStorageResult {
  let candidate = list;
  try {
    if (!storage) throw new Error("Storage unavailable");
    while (true) {
      try {
        storage.setItem(TRICKY_WORDS_STORAGE_KEY, JSON.stringify(candidate));
        return {
          list: candidate,
          persisted: true,
          warning:
            candidate === list
              ? null
              : "Browser storage is nearly full. Some oldest incorrect questions were removed to save newer ones.",
        };
      } catch (error) {
        if (!isQuotaError(error) || candidate.entries.length <= 1) throw error;
        // Free oldest entries only, in bounded batches rather than hundreds of large writes.
        const drop = Math.max(1, Math.ceil(candidate.entries.length / 10));
        candidate = {
          schemaVersion: 1,
          entries: candidate.entries.slice(drop),
        };
      }
    }
  } catch {
    return {
      list,
      persisted: false,
      warning:
        "Changes to your retry list could not be saved in this browser. They apply for this visit only; refreshing may restore the previous list.",
    };
  }
}
