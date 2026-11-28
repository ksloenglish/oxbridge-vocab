/** Oxbridge Ledger: pure revision-card helpers; every card field comes from the released record. */
import type {
  CollectionCatalogueItem,
  ReleaseQuestion,
  SegmentMode,
} from "@/types";

export const REVISION_POSITION_STORAGE_KEY = "kslo.oxbridge.revisionPosition.v1";

export interface SentencePart {
  text: string;
  highlight: boolean;
}

const LEADING_ARTICLE = /^(a|an|the)\s+(?=\S)/i;

/**
 * The example sentence is the stored cloze sentence with its single `{BLANK}` replaced by
 * the stored answer. The inserted form is the headword as used in the sentence (it may be
 * inflected), so that span is highlighted. A grammatical leading article supplied with the
 * answer ("an abrupt") stays unhighlighted unless the headword itself begins with it.
 */
export function buildExampleSentence(
  question: Pick<ReleaseQuestion, "question" | "answer" | "headword">
): SentencePart[] {
  const index = question.question.indexOf("{BLANK}");
  if (index < 0) return [{ text: question.question, highlight: false }];
  const before = question.question.slice(0, index);
  const after = question.question.slice(index + "{BLANK}".length);
  let article = "";
  let target = question.answer;
  const match = LEADING_ARTICLE.exec(question.answer);
  if (match) {
    const headwordStart = question.headword.trim().split(/\s+/)[0]?.toLowerCase();
    if (headwordStart !== match[1].toLowerCase()) {
      article = match[0];
      target = question.answer.slice(match[0].length);
    }
  }
  const parts: SentencePart[] = [];
  const lead = before + article;
  if (lead) parts.push({ text: lead, highlight: false });
  parts.push({ text: target, highlight: true });
  if (after) parts.push({ text: after, highlight: false });
  return parts;
}

/** B2 exists in both Oxford lists, so B2 cards name their list; other levels need no source tag. */
export function getCardSourceLabel(
  collection: Pick<CollectionCatalogueItem, "id" | "cefrLevel">
): string | null {
  if (collection.cefrLevel !== "B2") return null;
  if (collection.id.startsWith("ox3000")) return "Oxford 3000";
  if (collection.id.startsWith("ox5000")) return "Oxford 5000";
  return null;
}

/** Segments in catalogue order: the selected half, or both halves for Full list. */
export function getRevisionSegments(
  collection: CollectionCatalogueItem,
  mode: SegmentMode
) {
  return mode === "full"
    ? collection.segments
    : collection.segments.filter(segment => segment.id === mode);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Positions per release/selection; the oldest entries are dropped beyond this bound. */
export const MAX_REMEMBERED_POSITIONS = 50;

interface StoredPositions {
  positions: Record<string, number>;
}

function readPositions(target: StorageLike): Record<string, number> {
  try {
    const raw = target.getItem(REVISION_POSITION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredPositions>;
    const positions = parsed?.positions;
    if (!positions || typeof positions !== "object" || Array.isArray(positions)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(positions).filter(
        ([, value]) => Number.isInteger(value) && (value as number) >= 0
      )
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function revisionPositionKey(
  releaseVersion: string,
  collectionId: string,
  mode: SegmentMode
): string {
  return `${releaseVersion}|${collectionId}|${mode}`;
}

function safeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Returns a valid card index for this exact selection, or 0. */
export function readRevisionPosition(
  key: string,
  total: number,
  storage?: StorageLike
): number {
  const target = safeStorage(storage);
  if (!target || total <= 0) return 0;
  const index = readPositions(target)[key];
  return index !== undefined && index < total ? index : 0;
}

export function writeRevisionPosition(
  key: string,
  index: number,
  storage?: StorageLike
): void {
  const target = safeStorage(storage);
  if (!target) return;
  try {
    const positions = readPositions(target);
    // Re-inserting moves this selection to the newest end of the insertion order.
    delete positions[key];
    positions[key] = index;
    const keys = Object.keys(positions);
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_POSITIONS))) {
      delete positions[stale];
    }
    target.setItem(
      REVISION_POSITION_STORAGE_KEY,
      JSON.stringify({ positions } satisfies StoredPositions)
    );
  } catch {
    // Blocked storage only loses the remembered card, never the revision itself.
  }
}
