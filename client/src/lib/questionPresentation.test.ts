import { describe, expect, it } from "vitest";
import { getSentenceSizeClass, getVisibleSentenceLength } from "./questionPresentation";

describe("mobile sentence presentation", () => {
  it("counts the visible blank and normalises whitespace", () => {
    expect(getVisibleSentenceLength("A  {BLANK}   sentence.")).toBe(17);
  });

  it.each([
    ["x".repeat(47), "sentence-size--short"],
    ["x".repeat(48), "sentence-size--medium"],
    ["x".repeat(71), "sentence-size--medium"],
    ["x".repeat(72), "sentence-size--long"],
    ["x".repeat(94), "sentence-size--long"],
    ["x".repeat(95), "sentence-size--extra-long"],
  ])("assigns %s characters to %s", (question, expected) => {
    expect(getSentenceSizeClass(question)).toBe(expected);
  });
});
