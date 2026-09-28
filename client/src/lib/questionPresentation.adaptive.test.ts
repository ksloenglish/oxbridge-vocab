import { describe, expect, it } from "vitest";
import {
  computeSentenceFontSize,
  getSentenceLineBudget,
  getSentenceSizeClass,
  getVisibleSentenceLength,
} from "./questionPresentation";

describe("computeSentenceFontSize", () => {
  // A stand-in for real layout: lines are proportional to how much text each line holds.
  const wrapping = (charactersPerLineAtOne: number, textLength: number) => (size: number) =>
    Math.max(1, Math.ceil(textLength / (charactersPerLineAtOne * size)));

  it("grows the sentence while it still fits the budget", () => {
    const measureLines = wrapping(20, 400);
    const size = computeSentenceFontSize(
      { minFontSize: 24, maxFontSize: 46, measureLines },
      6,
    );
    expect(size).toBeGreaterThan(24);
    expect(size).toBeLessThanOrEqual(46);
    expect(measureLines(size)).toBeLessThanOrEqual(6);
  });

  it("never crosses the layer maximum", () => {
    const size = computeSentenceFontSize(
      { minFontSize: 24, maxFontSize: 46, measureLines: () => 1 },
      6,
    );
    expect(size).toBe(46);
  });

  it("stops at the readable floor rather than shrinking without limit", () => {
    // A budget that nothing can satisfy: the floor must still be returned.
    const size = computeSentenceFontSize(
      { minFontSize: 24, maxFontSize: 46, measureLines: () => 99 },
      2,
    );
    expect(size).toBe(24);
  });

  it("never returns a size below the floor for a cramped budget", () => {
    const measureLines = wrapping(20, 300);
    for (const maxLines of [1, 2, 3, 4, 5, 6]) {
      const size = computeSentenceFontSize(
        { minFontSize: 22, maxFontSize: 46, measureLines },
        maxLines,
      );
      expect(size).toBeGreaterThanOrEqual(22);
    }
  });

  it("returns a stable value when called repeatedly", () => {
    const measureLines = wrapping(20, 380);
    const first = computeSentenceFontSize(
      { minFontSize: 24, maxFontSize: 46, measureLines },
      4,
    );
    const second = computeSentenceFontSize(
      { minFontSize: 24, maxFontSize: 46, measureLines },
      4,
    );
    expect(first).toBe(second);
  });

  it("keeps a long sentence from being reduced below a short one's size on a tight desk", () => {
    const longSentence = computeSentenceFontSize(
      { minFontSize: 24, maxFontSize: 46, measureLines: wrapping(20, 600) },
      4,
    );
    expect(longSentence).toBeGreaterThanOrEqual(24);
  });
});

describe("getSentenceLineBudget", () => {
  it("derives the budget from the free height", () => {
    // 300px of room at a 24px floor with 1.13 line height fits 11 lines; the cap applies.
    expect(getSentenceLineBudget(300, 24, 1.13, 4)).toBe(4);
  });

  it("never returns less than one line", () => {
    expect(getSentenceLineBudget(1, 24, 1.13, 4)).toBe(1);
    expect(getSentenceLineBudget(0, 24, 1.13, 4)).toBe(1);
  });

  it("scales down with the room available", () => {
    expect(getSentenceLineBudget(60, 24, 1.13, 6)).toBe(2);
  });
});

describe("getVisibleSentenceLength", () => {
  it("counts the blank as rendered, not as the placeholder token", () => {
    expect(getVisibleSentenceLength("The {BLANK} of Texas")).toBe(
      "The _____ of Texas".length,
    );
  });
});

describe("getSentenceSizeClass", () => {
  it("still returns a band as the first guess before measurement", () => {
    expect(getSentenceSizeClass("x".repeat(20))).toBe("sentence-size--short");
    expect(getSentenceSizeClass("x".repeat(120))).toBe("sentence-size--extra-long");
  });
});