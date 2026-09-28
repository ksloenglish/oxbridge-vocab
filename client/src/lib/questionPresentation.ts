/** Oxbridge Ledger: sentence sizing for the reading desk, chosen from the space actually available. */
export type SentenceSizeClass =
  | "sentence-size--short"
  | "sentence-size--medium"
  | "sentence-size--long"
  | "sentence-size--extra-long";

/** Smallest to largest; the reading desk walks this list when fitting the sentence. */
export const SENTENCE_SIZE_ORDER: SentenceSizeClass[] = [
  "sentence-size--extra-long",
  "sentence-size--long",
  "sentence-size--medium",
  "sentence-size--short",
];

export function getVisibleSentenceLength(question: string): number {
  return question
    .replace("{BLANK}", "_____")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** Length band used as the starting guess before the sentence is measured on screen. */
export function getSentenceSizeClass(question: string): SentenceSizeClass {
  const length = getVisibleSentenceLength(question);
  if (length >= 95) return "sentence-size--extra-long";
  if (length >= 72) return "sentence-size--long";
  if (length >= 48) return "sentence-size--medium";
  return "sentence-size--short";
}

export interface SentenceFontConstraints {
  /** Smallest size the layer may use; treated as the readable floor, never crossed. */
  minFontSize: number;
  /** Largest size the layer may use, however much room is free. */
  maxFontSize: number;
  /** Rendered line count for a candidate font size. */
  measureLines: (fontSize: number) => number;
}

/**
 * Find the largest font size whose rendered line count stays within `maxLines`.
 *
 * A plain length band cannot decide this: two sentences of the same character count
 * wrap differently, and the same sentence wraps differently at different widths. So the
 * size is chosen from the line count the browser actually reports for each candidate.
 *
 * `maxLines` must be derived from the free vertical room by the caller, which is what
 * keeps the reading desk free of scroll. The search never goes below `minFontSize`, so a
 * cramped viewport produces readable text rather than an unreadable perfect fit.
 */
export function computeSentenceFontSize(
  constraints: SentenceFontConstraints,
  maxLines: number,
  steps = 12,
): number {
  const { minFontSize, maxFontSize, measureLines } = constraints;
  if (!(minFontSize > 0) || !(maxFontSize > 0)) return 0;
  if (maxFontSize <= minFontSize) return minFontSize;

  const budget = Math.max(1, Math.floor(maxLines));
  // If even the floor cannot fit, the floor still wins: readability before fit.
  if (measureLines(minFontSize) > budget) return minFontSize;

  let low = minFontSize;
  let high = maxFontSize;
  for (let step = 0; step < steps; step += 1) {
    const mid = (low + high) / 2;
    if (measureLines(mid) <= budget) {
      low = mid;
    } else {
      high = mid;
    }
  }
  // Quarter-pixel precision keeps the value stable across repeated measurements.
  return Math.round(low * 4) / 4;
}

/**
 * How many lines the sentence may occupy, given the room the reading desk has left.
 *
 * Derived from the free height so the sentence can never push the controls off screen.
 * `capLines` is a per-layer aesthetic ceiling; the floor of one line is always allowed.
 */
export function getSentenceLineBudget(
  availableHeightPx: number,
  minFontSizePx: number,
  lineHeightRatio: number,
  capLines: number,
): number {
  if (!(availableHeightPx > 0) || !(minFontSizePx > 0) || !(lineHeightRatio > 0)) return 1;
  const fittingLines = Math.floor(availableHeightPx / (minFontSizePx * lineHeightRatio));
  return Math.min(Math.max(fittingLines, 1), Math.max(1, Math.floor(capLines)));
}