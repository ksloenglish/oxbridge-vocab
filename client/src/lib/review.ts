import type { ExerciseSnapshot } from "@/types";

export function formatPractisedWords(exercise: ExerciseSnapshot): string {
  const heading = `Oxbridge Vocab Challenge — ${exercise.selection.collectionLabel}: ${exercise.selection.segmentLabel}`;
  const entries = exercise.questions.map(
    (question, index) => `${index + 1}. ${question.headword} — ${question.definition}`,
  );
  return [heading, "", ...entries].join("\n");
}

function copyWithTextArea(text: string): boolean {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  return copied;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose the API but reject it outside a permitted context.
    }
  }
  if (!copyWithTextArea(text)) {
    throw new Error("Clipboard copying is unavailable in this browser.");
  }
}
