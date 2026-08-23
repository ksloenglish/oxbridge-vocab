import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExercise } from "./exercise";
import { formatPractisedWords } from "./review";
import type { ReleaseCatalogue, SegmentRelease } from "@/types";

const releaseRoot = resolve(process.cwd(), "client/public/data/releases");
const catalogue = JSON.parse(
  readFileSync(resolve(releaseRoot, "catalog.json"), "utf8"),
) as ReleaseCatalogue;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

describe("practised-word clipboard formatting", () => {
  it("copies every practised word and definition once in exercise order", () => {
    const collection = catalogue.collections[0];
    const segment = collection.segments[0];
    const release = JSON.parse(
      readFileSync(resolve(releaseRoot, segment.dataFile), "utf8"),
    ) as SegmentRelease;
    const exercise = buildExercise(
      collection,
      segment.id,
      10,
      { [segment.id]: release.questions },
      catalogue.releaseVersion,
      seededRandom(42),
    );

    const copied = formatPractisedWords(exercise);
    const lines = copied.split("\n");
    expect(lines[0]).toBe(
      `Oxbridge Vocab Challenge — ${collection.label}: ${segment.label}`,
    );
    expect(lines[1]).toBe("");
    expect(lines).toHaveLength(exercise.questions.length + 2);
    exercise.questions.forEach((question, index) => {
      expect(lines[index + 2]).toBe(
        `${index + 1}. ${question.headword} — ${question.definition}`,
      );
    });
    expect(copied).not.toContain("{BLANK}");
  });
});
