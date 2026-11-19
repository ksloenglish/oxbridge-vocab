/** Guarded high-score storage: failures preserve the intended in-memory list, never prune. */
import {
  emptyHighScores,
  HIGH_SCORES_STORAGE_KEY,
  parseHighScores,
  type HighScoresList,
} from "./highScores";
import { browserStorage, type BrowserStorage } from "./trickyWordsStorage";

export interface HighScoresStorageResult {
  list: HighScoresList;
  persisted: boolean;
  warning: string | null;
}

/** Explicit confirmed reset: remove only scores, including corrupt or unreadable records. */
export function clearHighScoresStorage(
  storage: BrowserStorage | null = browserStorage()
): HighScoresStorageResult {
  const list = emptyHighScores();
  try {
    if (!storage) throw new Error("Storage unavailable");
    storage.removeItem(HIGH_SCORES_STORAGE_KEY);
    return { list, persisted: true, warning: null };
  } catch {
    return {
      list,
      persisted: false,
      warning:
        "High-score history could not be cleared from this browser. It is hidden for this visit only; refreshing may restore the previous high scores.",
    };
  }
}

export function readHighScoresStorage(
  storage: BrowserStorage | null = browserStorage()
): HighScoresStorageResult {
  try {
    if (!storage) throw new Error("Storage unavailable");
    return {
      list: parseHighScores(storage.getItem(HIGH_SCORES_STORAGE_KEY)),
      persisted: true,
      warning: null,
    };
  } catch {
    return {
      list: emptyHighScores(),
      persisted: false,
      warning:
        "Browser storage is unavailable. High scores will be kept for this visit only.",
    };
  }
}

export function writeHighScoresStorage(
  list: HighScoresList,
  storage: BrowserStorage | null = browserStorage()
): HighScoresStorageResult {
  try {
    if (!storage) throw new Error("Storage unavailable");
    // Re-project before persistence so a caller's extra fields cannot reach storage.
    const candidate = parseHighScores(JSON.stringify(list));
    storage.setItem(HIGH_SCORES_STORAGE_KEY, JSON.stringify(candidate));
    return { list: candidate, persisted: true, warning: null };
  } catch {
    // One attempt only: retaining fewer scores does not make a failed save safe.
    return {
      list,
      persisted: false,
      warning:
        "Your high scores could not be saved in this browser. They apply for this visit only; refreshing may restore the previous high scores.",
    };
  }
}
