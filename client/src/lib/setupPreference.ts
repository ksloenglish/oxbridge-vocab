/** Oxbridge Ledger: remembers the student's Home selections so a fresh visit reopens their last folio. */
import type { CollectionCatalogueItem, ReleaseCatalogue, SegmentMode } from "@/types";

export const SETUP_PREFERENCE_STORAGE_KEY = "kslo.oxbridge.setupPreference.v1";

/** The only question counts the folio offers; order matters for the nearest-lower fallback. */
export const QUESTION_COUNTS = [10, 20, 30, 40, 50, 100];

export interface SetupPreference {
  collectionId: string;
  mode: SegmentMode;
  count: number;
}

export const DEFAULT_QUESTION_COUNT = 10;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function resolveSetupPreference(
  catalogue: ReleaseCatalogue,
  preference: SetupPreference | null,
): SetupPreference {
  const collections = catalogue.collections;
  const fallback: SetupPreference = {
    collectionId: collections[0].id,
    mode: collections[0].segments[0].id,
    count: DEFAULT_QUESTION_COUNT,
  };
  if (!preference) return fallback;

  const collection =
    collections.find((item) => item.id === preference.collectionId) ?? collections[0];
  // A remembered range is only valid inside the collection it was chosen with.
  const mode =
    preference.collectionId === collection.id &&
    (preference.mode === "full" ||
      collection.segments.some((segment) => segment.id === preference.mode))
      ? preference.mode
      : collection.segments[0].id;
  const maximum = maximumQuestionCount(collection, mode);
  // Only a real chip may be remembered, so a stale or hand-edited value falls back
  // to the largest available chip instead of leaving no chip selected.
  const count = QUESTION_COUNTS.includes(preference.count)
    ? Math.min(preference.count, maximum)
    : [...QUESTION_COUNTS].reverse().find((item) => item <= maximum) ??
      DEFAULT_QUESTION_COUNT;

  return { collectionId: collection.id, mode, count };
}

export function maximumQuestionCount(
  collection: CollectionCatalogueItem,
  mode: SegmentMode,
): number {
  if (mode === "full") {
    return Math.min(...collection.segments.map((item) => item.availableCount)) * 2;
  }
  return collection.segments.find((item) => item.id === mode)?.availableCount ?? 0;
}

function safeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSetupPreference(storage?: StorageLike): SetupPreference | null {
  const target = safeStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(SETUP_PREFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SetupPreference>;
    if (
      typeof parsed?.collectionId !== "string" ||
      typeof parsed?.mode !== "string" ||
      typeof parsed?.count !== "number"
    ) {
      return null;
    }
    return {
      collectionId: parsed.collectionId,
      mode: parsed.mode,
      count: parsed.count,
    };
  } catch {
    return null;
  }
}

export function writeSetupPreference(
  preference: SetupPreference,
  storage?: StorageLike,
): void {
  const target = safeStorage(storage);
  if (!target) return;
  try {
    target.setItem(SETUP_PREFERENCE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // A blocked or full storage must never break the setup screen.
  }
}
