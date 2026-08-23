export type SentenceSizeClass =
  | "sentence-size--short"
  | "sentence-size--medium"
  | "sentence-size--long"
  | "sentence-size--extra-long";

export function getVisibleSentenceLength(question: string): number {
  return question
    .replace("{BLANK}", "_____")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function getSentenceSizeClass(question: string): SentenceSizeClass {
  const length = getVisibleSentenceLength(question);
  if (length >= 95) return "sentence-size--extra-long";
  if (length >= 72) return "sentence-size--long";
  if (length >= 48) return "sentence-size--medium";
  return "sentence-size--short";
}
